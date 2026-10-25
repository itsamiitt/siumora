import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { applyDeliveryReceipt, type SqlClient } from "../../../modules/outbox/data";
import { verifyCourierSignature as verifySignature } from "../../../modules/shiprocket-fulfillment/decide";

/**
 * POST /webhooks/messaging — delivery receipts from the WhatsApp BSP (plan
 * 16 Phase G; the Medusa port of Fastify's /webhooks/messaging).
 *
 * "sent" only means the provider accepted the message. Delivered, read and
 * failed arrive here, keyed by the provider's message id the worker stored
 * at send time — and that is what makes a paused template look like the
 * outage it is instead of a wall of green "sent" rows.
 *
 * Signed: an HMAC of the raw body under MESSAGING_WEBHOOK_SECRET in
 * x-messaging-signature. Unknown ids and replays are acknowledged, not
 * errored: receipts retry, and a 4xx would make the BSP hammer a receipt
 * nobody can route.
 */
export const AUTHENTICATE = false;

const STATUSES = new Set(["delivered", "read", "failed"]);

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const raw = (req as { rawBody?: string | Buffer }).rawBody;
  const header = req.headers["x-messaging-signature"];
  const signature = Array.isArray(header) ? header[0] : header;
  if (!verifySignature(raw, signature, process.env.MESSAGING_WEBHOOK_SECRET)) {
    res.status(401).json({ error: "invalid_signature" });
    return;
  }

  const body = (req.body ?? {}) as { provider_message_id?: unknown; status?: unknown; error?: unknown };
  if (typeof body.provider_message_id !== "string" || typeof body.status !== "string" || !STATUSES.has(body.status)) {
    res.status(400).json({ error: "invalid_request", message: "expected provider_message_id and status" });
    return;
  }

  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlClient;
  const result = await applyDeliveryReceipt(
    pg,
    body.provider_message_id,
    body.status as "delivered" | "read" | "failed",
    typeof body.error === "string" ? body.error : undefined,
  );
  res.json({ ok: true, result });
}
