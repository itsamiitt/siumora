import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { auditAction, requireOperator } from "../../../../../../../lib/operator-gate";
import {
  findIdentityByNumber,
  type SqlClient as IdentitySqlClient,
} from "../../../../../../../modules/siumora-order/allocate";
import { findOpenReturn, recordPayout, type SqlClient } from "../../../../../../../modules/returns-ndr/data";
import { decidePayout, parsePayoutBody } from "../../../../../../../modules/returns-ndr/lifecycle";
import { paymentMethodOf } from "../../../../../../../modules/siumora-order/checkout-rules";

/**
 * POST /admin/siumora/orders/:number/returns/payout — record the manual COD
 * payout (plan 16 B28, the Fastify route of the same path; design doc OV-2).
 *
 * A COD return has no capture to reverse, so the founder pays the
 * customer's VPA by hand and records the UPI/UTR reference here. Once: the
 * reference's presence is the idempotency guard — one parcel, one payout —
 * written by a conditional update so two clicks cannot both land. Gated on
 * remittance:write and audited (return.payout) with who recorded it.
 */
export const AUTHENTICATE = false;

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "remittance:write");
  if (!operator) return;

  const parsed = parsePayoutBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "invalid_request", message: parsed.message });
    return;
  }

  const number = req.params.number!;
  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlClient;
  const identity = await findIdentityByNumber(pg as unknown as IdentitySqlClient, number);
  if (!identity) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "metadata", "total"],
    filters: { id: identity.order_id },
  });
  const order = orders[0] as { metadata?: Record<string, unknown> | null; total?: unknown } | undefined;
  if (!order) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const openReturn = await findOpenReturn(pg, identity.order_id);
  const decision = decidePayout(paymentMethodOf(order.metadata), openReturn);
  if (!decision.ok) {
    res.status(decision.code).json({ error: decision.error, message: decision.message });
    return;
  }

  const updated = await recordPayout(pg, openReturn!.id, parsed.value.reference, new Date());
  if (!updated) {
    // Another operator recorded it between our read and our write.
    const again = await findOpenReturn(pg, identity.order_id);
    res.status(409).json({
      error: "already_paid",
      message: `Already paid out as ${again?.payout_reference ?? "another reference"}.`,
    });
    return;
  }

  await auditAction(req, operator, "return.payout", {
    subject: identity.order_number,
    detail: { reference: parsed.value.reference, amount: Number(order.total ?? 0) },
  });
  res.json({
    ok: true,
    return: {
      id: updated.id,
      status: updated.status,
      payoutReference: updated.payout_reference,
      payoutRecordedAt: updated.payout_recorded_at,
    },
  });
}
