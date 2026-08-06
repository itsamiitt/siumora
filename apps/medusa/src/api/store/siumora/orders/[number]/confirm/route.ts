import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { authoriseOrder } from "../../../../../../modules/returns-ndr/access";
import { setStatus } from "../../../../../../modules/returns-ndr/data";
import {
  decideConfirm,
  orderEnvelope,
  type OrderStatus,
} from "../../../../../../modules/returns-ndr/lifecycle";

/**
 * POST /store/siumora/orders/:number/confirm?key=<uuid> — confirm a held
 * order. Stands in for the WhatsApp OTP callback, exactly as the Fastify
 * route does.
 *
 * A COD order confirms at placement, so the reachable answer today is the
 * 409 illegal_transition the contract suite pins (sdk-contract.test.ts:
 * "COD confirms at placement — confirming again is a 409 illegal_transition.
 * That IS the contract; the Medusa transport must refuse identically.").
 * The legal arms — pending_payment (M3 Razorpay) and
 * awaiting_cod_confirmation (the COD-verification port) — are decided by
 * core's canTransition, so those ports inherit a working gate; what this
 * route does NOT do yet is allocate an invoice number on confirmation (the
 * M2 gst module owns the gapless series).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const found = await authoriseOrder(req, res);
  if (!found) return;

  const decision = decideConfirm(found.statusRow.status as OrderStatus);
  if (!decision.ok) {
    res.status(decision.code).json({ error: decision.error, message: decision.message });
    return;
  }

  const updated = await setStatus(found.pg, found.orderId, "confirmed");
  res.json(orderEnvelope(found.orderNumber, updated.status, 0, updated.ndr_reason));
}
