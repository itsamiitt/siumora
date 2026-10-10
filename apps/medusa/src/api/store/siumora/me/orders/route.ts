/**
 * GET /store/siumora/me/orders — the signed-in account's orders (auth plan
 * phase 2; flips the SDK's listOrders, track-m row 6).
 *
 * The account's orders are the ones recorded as its own on the order
 * identity: placed while signed in, or guest orders it confirmed through
 * "Is this your order?" (see ../claimable-orders). Each entry is the same
 * card the single-order read serves, plus the flat tax fields the
 * storefront's order list renders (the Fastify order row's names).
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { requireSession } from "../../../../../lib/customer-guard";
import { pgOf } from "../../../../../lib/customer-signin";
import { fetchOrders, orderCard } from "../../../../../lib/order-card";
import { taxFields } from "../../../../../modules/siumora-order/account-view";
import {
  identitiesOwnedBy,
  type SqlClient,
} from "../../../../../modules/siumora-order/ownership";

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const session = requireSession(req, res);
  if (!session) return;

  const identities = await identitiesOwnedBy(pgOf(req) as unknown as SqlClient, session.customerId);
  const orders = await fetchOrders(
    req.scope,
    identities.map((identity) => identity.order_id),
  );

  const cards = [];
  for (const identity of identities) {
    const order = orders.get(identity.order_id);
    if (!order) continue;
    const card = await orderCard(req.scope, identity, order);
    const province = String((card.order.address as { province?: unknown } | null)?.province ?? "");
    cards.push({
      ...card.order,
      ...taxFields(card.order.lines, card.invoice?.totals ?? null, province),
    });
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({ orders: cards });
}
