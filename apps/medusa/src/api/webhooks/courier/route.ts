import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { recordAudit, type SqlClient as AuditSqlClient } from "../../../modules/audit/data";
import {
  countNdrAttempts,
  ensureStatusRow,
  findShipmentByAwb,
  insertNdrEvent,
  setStatus,
  type SqlClient,
} from "../../../modules/returns-ndr/data";
import { decideAdvance, initialSiumoraStatus, type OrderStatus } from "../../../modules/returns-ndr/lifecycle";
import { shiprocketCredentials } from "../../../modules/shiprocket-fulfillment/credentials";
import {
  parseShiprocketWebhook,
  parseSignedCourierWebhook,
  verifyCourierSignature,
  verifyShiprocketToken,
  type CourierEvent,
} from "../../../modules/shiprocket-fulfillment/decide";
import { findIdentityByNumber, type SqlClient as IdentitySqlClient } from "../../../modules/siumora-order/allocate";
import { orderMoved } from "../../../lib/order-events";

/**
 * POST /webhooks/courier — the courier drives the order after booking
 * (plan 16 Phase F, B15; the Medusa port of Fastify's /webhooks/courier).
 *
 * Two senders, each authenticated before anything is read:
 * - Shiprocket's tracking push, carrying the token configured in its panel
 *   as x-api-key (Admin › Settings › Integrations › Shiprocket);
 * - the courier-neutral signed format, an HMAC of the raw body under
 *   COURIER_WEBHOOK_SECRET in x-courier-signature.
 * Neither is a person, so neither needs a session or an order access key:
 * the authentication is the authorisation.
 *
 * Moves go through the same state machine as the operator lever
 * (decideAdvance), so a courier can never force an illegal transition; a
 * status the order has already passed (couriers redeliver and reorder) is
 * acknowledged, not errored. Every move is audited as the courier — never
 * blamed on a person.
 */
export const AUTHENTICATE = false;

function header(req: MedusaRequest, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const pg = pgConnection as unknown as SqlClient;
  const raw = (req as { rawBody?: string | Buffer }).rawBody;

  let event: CourierEvent;
  let source: string;
  if (verifyCourierSignature(raw, header(req, "x-courier-signature"), process.env.COURIER_WEBHOOK_SECRET)) {
    event = parseSignedCourierWebhook(req.body);
    source = "courier:signed";
  } else {
    const credentials = await shiprocketCredentials(
      pgConnection as unknown as Parameters<typeof shiprocketCredentials>[0],
    );
    if (!verifyShiprocketToken(header(req, "x-api-key"), credentials.webhookToken)) {
      // 401, and no detail: telling a caller why helps them forge a better one.
      res.status(401).json({ error: "invalid_signature" });
      return;
    }
    event = parseShiprocketWebhook(req.body);
    source = "courier:shiprocket";
  }

  // Acknowledge rather than error: a payload we cannot route is not the
  // courier's fault to retry forever.
  if (event.kind === "ignored") {
    res.json({ ok: true, ignored: event.reason });
    return;
  }

  let orderId: string | undefined;
  let orderNumber = event.orderNumber;
  if (orderNumber) {
    orderId = (await findIdentityByNumber(pg as unknown as IdentitySqlClient, orderNumber))?.order_id;
  }
  if (!orderId && event.awb) {
    orderId = (await findShipmentByAwb(pg, event.awb))?.order_id;
  }
  if (!orderId) {
    res.json({ ok: true, ignored: "unknown order" });
    return;
  }
  if (!orderNumber) {
    const found = await pg.raw(
      "SELECT order_number FROM siumora_order_identity WHERE order_id = ? AND deleted_at IS NULL",
      [orderId],
    );
    orderNumber = (found.rows[0] as { order_number?: string } | undefined)?.order_number ?? orderId;
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({ entity: "order", fields: ["id", "status"], filters: { id: orderId } });
  const medusaStatus = (orders[0] as { status?: string } | undefined)?.status ?? "pending";

  const row = await ensureStatusRow(pg, orderId, initialSiumoraStatus(medusaStatus));
  const attempts = await countNdrAttempts(pg, orderId);
  const decision = decideAdvance(row.status as OrderStatus, event.status, attempts, event.ndrReason, row.ndr_reason);
  if (!decision.ok) {
    res.json({ ok: true, replayed: true, status: row.status });
    return;
  }

  const updated = await setStatus(pg, orderId, decision.status, decision.ndrReason ?? undefined);
  // The customer's message and the conversion for the new status (plan 16 Phase G).
  await orderMoved(req.scope, orderId, updated.status);
  if (decision.recordNdr) {
    await insertNdrEvent(pg, {
      orderId,
      reason: decision.ndrReason ?? "customer_unavailable",
      attempt: decision.deliveryAttempts,
    });
  }
  await recordAudit(pgConnection as unknown as AuditSqlClient, {
    actorId: null,
    actorContact: source,
    actorRole: "courier",
    action: "order.status",
    subject: orderNumber,
    detail: { from: row.status, to: updated.status, ...(event.awb ? { awb: event.awb } : {}) },
  });

  res.json({ ok: true, status: updated.status });
}
