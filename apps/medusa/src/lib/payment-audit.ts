import { recordAudit, type SqlClient } from "../modules/audit/data.ts";

/**
 * The audit row for money sent back automatically because no order exists
 * behind it (plan 16 B12, plan 18 L1.2): the paid-but-not-placed refund at
 * completion, a superseded payment, and the recon sweep's ledger refund.
 *
 * The `[money-alert]` log line tells a person the same hour; this row is
 * what remains a year later when someone asks why the money went back. A
 * failed refund is recorded too — that is the one that still owes money.
 *
 * Written once per refund attempt: every caller returns early once Razorpay
 * reports the payment refunded, so a replay attempts nothing and records
 * nothing. Never throws — losing the audit line must not lose the refund.
 */
export async function auditUnplacedRefund(
  pg: SqlClient,
  entry: {
    source: "checkout" | "recon";
    razorpayOrderId?: string | undefined;
    paymentId: string;
    amountPaise: number;
    cartId?: string | null | undefined;
    sessionId?: string | undefined;
    ok: boolean;
    refundId?: string | undefined;
    error?: string | undefined;
  },
): Promise<void> {
  await recordAudit(pg, {
    actorId: null,
    actorContact: entry.source === "recon" ? "payment-recon" : "checkout",
    actorRole: "system",
    action: entry.ok ? "payment.refund_unplaced" : "payment.refund_unplaced_failed",
    subject: entry.paymentId,
    detail: {
      amountPaise: entry.amountPaise,
      razorpayOrderId: entry.razorpayOrderId ?? null,
      cartId: entry.cartId ?? null,
      sessionId: entry.sessionId ?? null,
      refundId: entry.refundId ?? null,
      ...(entry.error ? { error: entry.error } : {}),
    },
  }).catch(() => undefined);
}
