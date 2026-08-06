import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { authoriseOrder } from "../../../../../../modules/returns-ndr/access";
import {
  countNdrAttempts,
  recordNdrAction,
  setStatus,
} from "../../../../../../modules/returns-ndr/data";
import {
  decideNdrAnswer,
  orderEnvelope,
  parseNdrBody,
} from "../../../../../../modules/returns-ndr/lifecycle";

/**
 * POST /store/siumora/orders/:number/ndr?key=<uuid> — the customer's answer
 * to a failed delivery. Deliberately NOT simulation-gated (the Fastify route
 * is not either): answering an NDR on your own order is the customer's
 * right, not a courier move.
 *
 * Semantics mirror the Fastify route: only an order sitting in "ndr" can be
 * answered (409 not_awaiting_answer otherwise); "cancel" moves it to
 * cancelled; reattempt/update_address recover to out_for_delivery unless
 * core's ndrState says the attempts are exhausted or the parcel was refused
 * (409 not_recoverable). An accepted answer is recorded on the latest NDR
 * event row, so the log reads as what actually happened. Envelope: {ok,
 * order}.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const found = await authoriseOrder(req, res);
  if (!found) return;

  const parsed = parseNdrBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "invalid_request", message: parsed.message });
    return;
  }

  const attempts = await countNdrAttempts(found.pg, found.orderId);
  const decision = decideNdrAnswer(
    found.statusRow.status,
    parsed.value.action,
    attempts,
    found.statusRow.ndr_reason,
  );
  if (!decision.ok) {
    res.status(decision.code).json({ error: decision.error, message: decision.message });
    return;
  }

  await recordNdrAction(found.pg, found.orderId, parsed.value.action);
  const updated = await setStatus(found.pg, found.orderId, decision.target);

  res.json(orderEnvelope(found.orderNumber, updated.status, attempts, updated.ndr_reason));
}
