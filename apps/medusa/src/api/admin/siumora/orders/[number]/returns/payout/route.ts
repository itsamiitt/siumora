import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { refundPaymentWorkflow } from "@medusajs/medusa/core-flows";

import { auditAction, requireOperator } from "../../../../../../../lib/operator-gate";
import {
  findIdentityByNumber,
  type SqlClient as IdentitySqlClient,
} from "../../../../../../../modules/siumora-order/allocate";
import {
  findOpenReturn,
  recordPayout,
  releasePayout,
  type SqlClient,
} from "../../../../../../../modules/returns-ndr/data";
import {
  decideInstrumentRefund,
  decidePayout,
  parsePayoutBody,
} from "../../../../../../../modules/returns-ndr/lifecycle";
import { majorToPaise, wireNumber } from "../../../../../../../modules/siumora-order/identity";
import {
  RAZORPAY_PROVIDER_ID,
  orderPayments,
  settlementOf,
  type RawClient,
} from "../../../../../../../modules/siumora-order/payment-method";

/**
 * POST /admin/siumora/orders/:number/returns/payout — settle an approved
 * return's money (plan 16 B28, the Fastify route of the same path; design
 * doc OV-2).
 *
 * COD: a COD return has no capture to reverse, so the founder pays the
 * customer's VPA by hand and records the UPI/UTR reference here. Once: the
 * reference's presence is the idempotency guard — one parcel, one payout —
 * written by a conditional update so two clicks cannot both land.
 *
 * Prepaid (security review, item 8): decided by the payment Medusa recorded,
 * not the order's metadata. The returned lines go back to the instrument
 * through Medusa's refundPaymentWorkflow (the Razorpay provider's
 * refundPayment, and the refund recorded on the order). No body needed. The
 * same conditional claim guards it — taken before the refund, released if
 * the refund fails — so a double click refunds once.
 *
 * Called once the parcel is back in hand, like the COD payout: the
 * auto-approval at request time promises the refund; it does not send
 * money for goods still with the shopper. Gated on remittance:write and
 * audited (return.payout / return.refund) with who did it.
 */
export const AUTHENTICATE = false;

interface OrderWire {
  total?: unknown;
  items?: Array<{ variant_id?: string | null; total?: unknown } | null> | null;
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "remittance:write");
  if (!operator) return;

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
    fields: ["id", "total", "items.variant_id", "items.total"],
    filters: { id: identity.order_id },
  });
  const order = orders[0] as OrderWire | undefined;
  if (!order) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const payments = await orderPayments(pg as unknown as RawClient, identity.order_id);
  const openReturn = await findOpenReturn(pg, identity.order_id);
  if (settlementOf(payments) === "prepaid") {
    await refundToInstrument(req, res, { pg, operator, number, order, payments, openReturn });
    return;
  }

  const parsed = parsePayoutBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "invalid_request", message: parsed.message });
    return;
  }
  const decision = decidePayout("cod", openReturn);
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

async function refundToInstrument(
  req: MedusaRequest,
  res: MedusaResponse,
  input: {
    pg: SqlClient;
    operator: NonNullable<Awaited<ReturnType<typeof requireOperator>>>;
    number: string;
    order: OrderWire;
    payments: Awaited<ReturnType<typeof orderPayments>>;
    openReturn: Awaited<ReturnType<typeof findOpenReturn>>;
  },
): Promise<void> {
  const { pg, operator, number, openReturn } = input;
  const captured = input.payments.find(
    (payment) => payment.provider_id === RAZORPAY_PROVIDER_ID && payment.captured_at,
  );
  const decision = decideInstrumentRefund({
    openReturn,
    payment: captured && {
      capturedPaise: majorToPaise(wireNumber(captured.amount, "payment.amount")),
      refundedPaise: majorToPaise(wireNumber(captured.refunded ?? 0, "payment.refunded")),
    },
    lines: (input.order.items ?? []).filter(Boolean).map((item) => ({
      variantId: item!.variant_id ?? null,
      totalPaise: majorToPaise(wireNumber(item!.total ?? 0, "items.total")),
    })),
  });
  if (!decision.ok) {
    res.status(decision.code).json({ error: decision.error, message: decision.message });
    return;
  }

  // Claimed before the money moves: a second click finds the reference set.
  const reference = `razorpay-refund:${captured!.id}`;
  const claimed = await recordPayout(pg, openReturn!.id, reference, new Date());
  if (!claimed) {
    res.status(409).json({ error: "already_paid", message: "This return is already being refunded." });
    return;
  }

  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER) as { error(message: string): void };
  try {
    await refundPaymentWorkflow(req.scope).run({
      input: {
        payment_id: captured!.id,
        amount: decision.amountPaise / 100,
        created_by: operator.actorId,
        note: `Return on ${number}`,
      },
    });
  } catch (error) {
    await releasePayout(pg, openReturn!.id, reference).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      `[money-alert] return refund FAILED for ${number}: payment ${captured!.id} ${decision.amountPaise} paise — ${message}`,
    );
    res.status(502).json({
      error: "refund_failed",
      message: "Razorpay did not take the refund. Nothing was recorded — try again, or check the payment in Razorpay.",
    });
    return;
  }
  logger.error(
    `[money-alert] return refund: ${number} payment ${captured!.id} refunded ${decision.amountPaise} paise to the instrument`,
  );

  await auditAction(req, operator, "return.refund", {
    subject: number,
    detail: { reference, amountPaise: decision.amountPaise },
  });
  res.json({
    ok: true,
    return: {
      id: claimed.id,
      status: claimed.status,
      payoutReference: claimed.payout_reference,
      payoutRecordedAt: claimed.payout_recorded_at,
    },
    refund: { amountPaise: decision.amountPaise },
  });
}
