/**
 * GET /store/siumora/me/data — everything this stack holds about the
 * signed-in customer, as one JSON file (DPDP right of access; flips the
 * SDK's exportMyData). Sessions are listed as metadata only — device and
 * dates, never a token or its hash.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { ICustomerModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

import { requireSession } from "../../../../../lib/customer-guard";
import { pgOf } from "../../../../../lib/customer-signin";
import { realEmail } from "../../../../../lib/guest-email";
import { fetchOrders, orderCard } from "../../../../../lib/order-card";
import { listSessions, readAuthEvents } from "../../../../../modules/customer-session/data";
import { identitiesOwnedBy, type SqlClient } from "../../../../../modules/siumora-order/ownership";

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const session = requireSession(req, res);
  if (!session) return;

  const pg = pgOf(req);
  const now = new Date();
  const customers = req.scope.resolve<ICustomerModuleService>(Modules.CUSTOMER);
  const customer = await customers.retrieveCustomer(session.customerId, {
    select: ["id", "phone", "email", "first_name", "last_name", "created_at", "metadata"],
    relations: ["addresses"],
  });

  const identities = await identitiesOwnedBy(pg as unknown as SqlClient, session.customerId, 500);
  const orders = await fetchOrders(req.scope, identities.map((identity) => identity.order_id));
  const orderCards = [];
  for (const identity of identities) {
    const order = orders.get(identity.order_id);
    if (order) orderCards.push(await orderCard(req.scope, identity, order));
  }

  const [sessions, events] = await Promise.all([
    listSessions(pg, session.customerId, now),
    readAuthEvents(pg, { customerId: session.customerId, limit: 200 }),
  ]);

  res.setHeader("Cache-Control", "no-store");
  res.json({
    exportedAt: now.toISOString(),
    customer: {
      id: customer.id,
      phone: customer.phone,
      name: [customer.first_name ?? "", customer.last_name ?? ""].join(" ").trim(),
      email: realEmail(customer.email),
      createdAt: customer.created_at,
    },
    addresses: (customer.addresses ?? []).map((address) => ({
      name: [address.first_name ?? "", address.last_name ?? ""].join(" ").trim(),
      phone: address.phone,
      line1: address.address_1,
      line2: address.address_2,
      city: address.city,
      stateCode: address.province,
      pincode: address.postal_code,
    })),
    orders: orderCards,
    sessions: sessions.map((row) => ({
      device: row.device,
      signedInAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
    })),
    signInHistory: events.map((event) => ({
      type: event.type,
      channel: event.channel,
      device: event.device,
      at: event.created_at,
    })),
  });
}
