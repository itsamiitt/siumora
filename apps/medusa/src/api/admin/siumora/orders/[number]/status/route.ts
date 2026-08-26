import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { auditAction, requireOperator } from "../../../../../../lib/operator-gate";
import {
  findIdentityByNumber,
  type SqlClient as IdentitySqlClient,
} from "../../../../../../modules/siumora-order/allocate";
import {
  countNdrAttempts,
  ensureStatusRow,
  insertNdrEvent,
  setStatus,
  type SqlClient,
} from "../../../../../../modules/returns-ndr/data";
import {
  decideAdvance,
  initialSiumoraStatus,
  orderEnvelope,
  parseStatusBody,
  type OrderStatus,
} from "../../../../../../modules/returns-ndr/lifecycle";

/**
 * POST /admin/siumora/orders/:number/status — the OPERATOR's transition
 * lever, the grant the store status route names as "arrives with the M2
 * operator module". Same state machine, same collapse (core canTransition /
 * outcomeFor via decideAdvance), same {ok, order} envelope as the store
 * simulation route — but gated on orders:write instead of the courier
 * simulation, needing no access key (parity row: "an operator can read any
 * order" — and move it), and audited (order.status).
 */
export const AUTHENTICATE = false;

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "orders:write");
  if (!operator) return;

  const number = req.params.number!;
  const pg = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as SqlClient;

  const identity = await findIdentityByNumber(
    pg as unknown as IdentitySqlClient,
    number,
  );
  if (!identity) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "status"],
    filters: { id: identity.order_id },
  });
  const order = orders[0] as { status: string } | undefined;
  if (!order) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const parsed = parseStatusBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "invalid_request", message: parsed.message });
    return;
  }

  const statusRow = await ensureStatusRow(
    pg,
    identity.order_id,
    initialSiumoraStatus(order.status),
  );

  const attempts = await countNdrAttempts(pg, identity.order_id);
  const decision = decideAdvance(
    statusRow.status as OrderStatus,
    parsed.value.status,
    attempts,
    parsed.value.ndrReason,
    statusRow.ndr_reason,
  );
  if (!decision.ok) {
    res.status(decision.code).json({ error: decision.error, message: decision.message });
    return;
  }

  const updated = await setStatus(
    pg,
    identity.order_id,
    decision.status,
    decision.ndrReason ?? undefined,
  );
  if (decision.recordNdr) {
    await insertNdrEvent(pg, {
      orderId: identity.order_id,
      reason: decision.ndrReason ?? "customer_unavailable",
      attempt: decision.deliveryAttempts,
    });
  }

  await auditAction(req, operator, "order.status", {
    subject: identity.order_number,
    detail: { from: statusRow.status, to: updated.status },
  });

  res.json(
    orderEnvelope(
      identity.order_number,
      updated.status,
      decision.deliveryAttempts,
      updated.ndr_reason,
    ),
  );
}
