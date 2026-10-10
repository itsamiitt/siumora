/**
 * GET /store/siumora/me/claimable-orders — "Is this your order?" (auth plan
 * phase 2). Guest orders placed on this account's phone that nobody owns
 * yet, each shown thinly (number, date, pieces, total, city) so a recycled
 * number's new owner learns nothing worth having from someone else's order.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { claimableIdentities } from "../../../../../lib/claimable";
import { requireSession } from "../../../../../lib/customer-guard";
import { fetchOrders, orderLines } from "../../../../../lib/order-card";
import { claimableView } from "../../../../../modules/siumora-order/account-view";
import { majorToPaise, wireNumber } from "../../../../../modules/siumora-order/identity";

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const session = requireSession(req, res);
  if (!session) return;

  const identities = await claimableIdentities(req, session.customerId);
  const orders = await fetchOrders(
    req.scope,
    identities.map((identity) => identity.order_id),
  );

  const claimable = identities.flatMap((identity) => {
    const order = orders.get(identity.order_id);
    if (!order) return [];
    return [
      claimableView({
        orderNumber: identity.order_number,
        placedAt: order.created_at,
        lines: orderLines(order),
        shipping: majorToPaise(wireNumber(order.shipping_total, "shipping_total")),
        city: order.shipping_address?.city,
      }),
    ];
  });

  res.setHeader("Cache-Control", "no-store");
  res.json({ orders: claimable });
}
