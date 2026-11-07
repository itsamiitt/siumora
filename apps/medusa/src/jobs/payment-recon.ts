import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { processPaymentWorkflow } from "@medusajs/medusa/core-flows";

import { createRazorpayClient } from "../modules/razorpay-payment/client";
import { razorpayCredentials } from "../modules/razorpay-payment/credentials";
import { majorFromPaise, readPayments, reconAction } from "../modules/razorpay-payment/decide";
import { RAZORPAY_PROVIDER_ID } from "../modules/razorpay-payment/index";
import {
  LEDGER_GRACE_MS,
  ledgerAction,
  ledgerContext,
  openLedgerOrders,
  refundPaise,
  settleLedgerOrder,
  type RawClient,
} from "../modules/siumora-order/razorpay-ledger";

/**
 * Payment reconciliation (plan 16 Phase B, B13) — every 15 minutes, 48-hour
 * lookback, the Medusa port of apps/api/src/lib/recon.ts.
 *
 * The webhook is the fast path; this is the truth path. A shopper who paid
 * and lost their connection, a webhook Razorpay never delivered or Medusa
 * dropped, an `authorized` that auto-capture missed — all of them end here,
 * because Razorpay is asked directly about every open Razorpay session that
 * has no payment recorded yet.
 *
 * It replays exactly what the webhook would have done (processPaymentWorkflow
 * with the same action), so there is one completion path, not two that can
 * drift. A replay over a cart that already completed is a no-op — completion
 * is idempotent per cart — and a cart that can no longer complete (stock gone)
 * has its payment refunded by Medusa's own compensation.
 */

const LOOKBACK_MS = 48 * 3_600_000;

interface OpenSession {
  id: string;
  data?: Record<string, unknown> | null;
  payment?: { id: string } | null;
}

export default async function paymentRecon(container: MedusaContainer): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const credentials = await razorpayCredentials(
    pg as unknown as Parameters<typeof razorpayCredentials>[0],
  );
  if (!credentials.configured || !credentials.keyId || !credentials.keySecret) return;
  const client = createRazorpayClient({ keyId: credentials.keyId, keySecret: credentials.keySecret });

  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "payment_session",
    fields: ["id", "data", "payment.id"],
    filters: {
      provider_id: RAZORPAY_PROVIDER_ID,
      status: ["pending", "requires_more", "authorized"],
      created_at: { $gte: new Date(Date.now() - LOOKBACK_MS) },
    },
  });
  const open = (data as OpenSession[]).filter((session) => !session.payment);

  let replayed = 0;
  for (const session of open) {
    const orderId = session.data?.razorpay_order_id;
    const amountPaise = session.data?.amount_paise;
    if (typeof orderId !== "string" || typeof amountPaise !== "number") continue;

    const listed = await client.fetchOrderPayments(orderId);
    if (!listed.ok) {
      logger.warn(`payment recon: could not read ${orderId} — next sweep retries (${listed.error})`);
      continue;
    }
    const action = reconAction(readPayments(listed.payments, amountPaise));
    if (action === "none") continue;
    if (action === "flag") {
      logger.error(`payment recon: ${orderId} was paid a different amount than session ${session.id} — needs a person`);
      continue;
    }
    try {
      await processPaymentWorkflow(container).run({
        input: { action, data: { session_id: session.id, amount: majorFromPaise(amountPaise) } },
      });
      replayed += 1;
    } catch (error) {
      logger.error(
        `payment recon: replaying ${action} for session ${session.id} failed — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Silent when there was nothing to do, same as the Fastify sweep.
  if (open.length > 0) {
    logger.info(`payment recon: checked ${open.length}, replayed ${replayed}`);
  }

  await sweepLedger(pg as unknown as RawClient, client, logger);
}

/**
 * The ledger sweep (security review, item 2): every Razorpay order we
 * created, not just the ones a live session still names. A capture on an
 * order that no Medusa payment recorded and nothing can complete any more
 * (superseded by a later prepare, or its cart completed another way) is
 * refunded — the shopper paid for an order that will never exist.
 */
async function sweepLedger(
  pg: RawClient,
  client: ReturnType<typeof createRazorpayClient>,
  logger: { warn(message: string): void; error(message: string): void },
): Promise<void> {
  const now = Date.now();
  const rows = await openLedgerOrders(pg, new Date(now - LEDGER_GRACE_MS));
  for (const row of rows) {
    try {
      const listed = await client.fetchOrderPayments(row.razorpay_order_id);
      if (!listed.ok) {
        logger.warn(`payment recon: could not read ${row.razorpay_order_id} — next sweep retries (${listed.error})`);
        continue;
      }
      const reading = readPayments(listed.payments, row.amount_paise);
      const action = ledgerAction({
        reading,
        ...(await ledgerContext(pg, row)),
        ageMs: now - new Date(row.created_at).getTime(),
      });
      if (action === "wait") continue;
      if (action !== "refund") {
        await settleLedgerOrder(pg, row.razorpay_order_id, action);
        continue;
      }
      if (reading.state !== "captured" && reading.state !== "mismatch") continue;
      const amountPaise = refundPaise(reading, row);
      const refund = await client.refundPayment(reading.paymentId, {
        amountPaise,
        notes: { reason: "order_not_placed", razorpay_order_id: row.razorpay_order_id },
      });
      await settleLedgerOrder(pg, row.razorpay_order_id, refund.ok ? "refunded" : "refund_failed");
      logger.error(
        refund.ok
          ? `[money-alert] auto-refund: razorpay ${row.razorpay_order_id} payment ${reading.paymentId} ` +
              `(cart ${row.cart_id ?? "unknown"}) captured with no order — refunded ${amountPaise} paise`
          : `[money-alert] REFUND FAILED: razorpay ${row.razorpay_order_id} payment ${reading.paymentId} ` +
              `(cart ${row.cart_id ?? "unknown"}) ${amountPaise} paise — ${refund.error}; retried next sweep`,
      );
    } catch (error) {
      logger.error(
        `payment recon: ledger row ${row.razorpay_order_id} failed — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const config = {
  name: "siumora-payment-recon",
  schedule: "*/15 * * * *",
};
