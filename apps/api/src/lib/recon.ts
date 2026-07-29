import type { FastifyInstance } from "fastify";

import { and, eq, gte, schema, sql } from "@siumora/db";
import { getOrderByNumber } from "@siumora/db";

import { setOrderStatus } from "./invoicing.ts";

/**
 * Payment reconciliation (plan W1): every 15 minutes, 48-hour lookback.
 *
 * The webhook is the fast path; this is the truth path. A customer who paid
 * and lost their connection, a webhook the platform dropped, an `authorized`
 * that auto-capture missed — all of them end here, because the provider is
 * asked directly what happened to every prepaid order still waiting.
 *
 * It runs inside the API process, not the worker, on purpose: confirming an
 * order allocates its invoice number and queues its conversion and its
 * customer message, and all of that lives in `setOrderStatus`. A second
 * implementation in the worker would drift from the real one — the exact bug
 * the invoice hub exists to prevent.
 */

export interface ReconReport {
  readonly checked: number;
  readonly confirmed: number;
  /** Authorized but not yet captured, and the capture attempt failed. */
  readonly capturePending: number;
}

export const RECON_INTERVAL_MS = 15 * 60_000;
export const RECON_LOOKBACK_MS = 48 * 3_600_000;

export async function reconcilePayments(
  server: FastifyInstance,
  options: { now?: Date; lookbackMs?: number } = {},
): Promise<ReconReport> {
  if (!server.payments) return { checked: 0, confirmed: 0, capturePending: 0 };

  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - (options.lookbackMs ?? RECON_LOOKBACK_MS));

  const waiting = await server.db
    .select({ number: schema.orders.number })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.status, "pending_payment"),
        sql`${schema.orders.paymentMethod} <> 'cod'`,
        sql`${schema.orders.razorpayOrderId} IS NOT NULL`,
        gte(schema.orders.placedAt, cutoff),
      ),
    );

  let confirmed = 0;
  let capturePending = 0;

  for (const row of waiting) {
    // Re-fetched with lines: confirming allocates the invoice, and the invoice
    // needs the lines.
    const order = await getOrderByNumber(server.db, row.number);
    if (!order || order.status !== "pending_payment" || !order.razorpayOrderId) {
      continue;
    }

    const result = await server.payments.fetchOrderPayments(order.razorpayOrderId);
    if (!result.ok) {
      server.log?.warn?.(
        { orderNumber: order.number, error: result.error },
        "recon could not read payments — next sweep retries",
      );
      continue;
    }

    const captured = result.payments.find((p) => p.status === "captured");
    if (captured) {
      await setOrderStatus(server, order, "confirmed", {
        razorpayPaymentId: captured.id,
      });
      confirmed += 1;
      continue;
    }

    const authorized = result.payments.find((p) => p.status === "authorized");
    if (authorized) {
      const capture = await server.payments.capturePayment(
        authorized.id,
        order.total,
      );
      if (capture.ok) {
        await setOrderStatus(server, order, "confirmed", {
          razorpayPaymentId: authorized.id,
        });
        confirmed += 1;
      } else {
        capturePending += 1;
      }
    }
  }

  return { checked: waiting.length, confirmed, capturePending };
}

/** Start the sweep. Returns the stop function; a no-op without a provider. */
export function startPaymentRecon(
  server: FastifyInstance,
  intervalMs: number = RECON_INTERVAL_MS,
): () => void {
  if (!server.payments) return () => {};

  const timer = setInterval(() => {
    void reconcilePayments(server)
      .then((report) => {
        // Silent when there was nothing to do, same as the worker loop.
        if (report.checked > 0) server.log?.info?.(report, "payment recon");
      })
      .catch((error) => server.log?.error?.(error, "payment recon failed"));
  }, intervalMs);
  timer.unref?.();

  return () => clearInterval(timer);
}
