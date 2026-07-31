import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import {
  allocateIdentity,
  type SqlClient,
} from "../modules/siumora-order/allocate";

/**
 * Belt-and-braces for the identity invariant: EVERY placed order gets a SIU
 * number + access key, however it was placed — the complete route, the
 * native /store/carts/:id/complete, an admin draft order.
 *
 * The complete route already allocates synchronously (the checkout response
 * needs the number); this subscriber covers orders placed around it, and
 * heals the crash window where completion succeeded but the route died
 * before allocating. Racing the route is safe by construction: both funnel
 * into the same single-statement INSERT … ON CONFLICT (order_id), so
 * exactly one row wins and the loser reads it back. The cost of a lost race
 * is one burned sequence value — a gap, which order numbers are allowed.
 */
export default async function siumoraOrderIdentityHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>): Promise<void> {
  const pg = container.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as SqlClient;
  await allocateIdentity(pg, {
    orderId: data.id,
    cartId: null,
    idempotencyKey: null,
  });
}

export const config: SubscriberConfig = {
  event: "order.placed",
};
