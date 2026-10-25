import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { processPaymentWorkflow } from "@medusajs/medusa/core-flows";

import { createRazorpayClient } from "../modules/razorpay-payment/client";
import { razorpayCredentials } from "../modules/razorpay-payment/credentials";
import { majorFromPaise, readPayments, reconAction } from "../modules/razorpay-payment/decide";
import { RAZORPAY_PROVIDER_ID } from "../modules/razorpay-payment/index";

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
}

export const config = {
  name: "siumora-payment-recon",
  schedule: "*/15 * * * *",
};
