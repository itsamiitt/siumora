import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { type GstTxClient } from "../modules/gst/allocate";
import { orderMoved } from "../lib/order-events";
import { ensureInvoiceForOrder, type GraphQuery } from "../modules/gst/issue";
import {
  allocateIdentity,
  type SqlClient,
} from "../modules/siumora-order/allocate";

/**
 * Belt-and-braces for the identity invariant: EVERY placed order gets a SIU
 * number + access key, however it was placed — the complete route, the
 * native /store/carts/:id/complete, an admin draft order, or a Razorpay
 * webhook completing the cart after the browser dropped (plan 16 Phase B).
 *
 * The complete route already allocates synchronously (the checkout response
 * needs the number); this subscriber covers orders placed around it, and
 * heals the crash window where completion succeeded but the route died
 * before allocating. Racing the route is safe by construction: both funnel
 * into the same single-statement INSERT … ON CONFLICT (order_id), so
 * exactly one row wins and the loser reads it back. The cost of a lost race
 * is one burned sequence value — a gap, which order numbers are allowed.
 *
 * The statutory invoice follows the same rule: issued here too, idempotent
 * per order (allocate.ts ON CONFLICT), so a webhook-completed prepaid order
 * is invoiced exactly as one the browser completed. A refusal is logged,
 * never thrown — the order stands either way.
 */
export default async function siumoraOrderIdentityHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>): Promise<void> {
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  await allocateIdentity(pgConnection as unknown as SqlClient, {
    orderId: data.id,
    cartId: null,
    idempotencyKey: null,
  });

  try {
    await ensureInvoiceForOrder(
      pgConnection as unknown as GstTxClient,
      container.resolve(ContainerRegistrationKeys.QUERY) as unknown as GraphQuery,
      data.id,
    );
  } catch (error) {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as {
      error(message: string): void;
    };
    logger.error(
      `gst invoice was not issued for order ${data.id} — chase this, the books depend on it: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Placed is confirmed (COD confirms at placement, prepaid completes only
  // once paid): the order confirmation message, and the purchase conversion
  // for a prepaid order (plan 16 Phase G). Event-keyed, so a replayed event
  // queues nothing new.
  await orderMoved(container, data.id, "confirmed");
}

export const config: SubscriberConfig = {
  event: "order.placed",
};
