import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { fetchOrders, orderCard } from "../../../../../lib/order-card";
import {
  findIdentityByNumber,
  type SqlClient,
} from "../../../../../modules/siumora-order/allocate";
import { isWellFormedAccessKey, ownsOrder } from "../../../../../modules/siumora-order/identity";

/**
 * GET /store/siumora/orders/:number?key=<uuid> — the guest order read.
 *
 * The recorded contract (apps/api/src/sdk-contract.test.ts, getOrder):
 * - a MALFORMED key (not a uuid) is a 400 invalid_request — the caller's
 *   client is broken, tell it so;
 * - NO key, a wrong-but-well-formed key, or an unknown number are all the
 *   same 404 not_found — never a 403, because a 403 would confirm the order
 *   number is real, which is exactly what an enumeration walk is after
 *   (order numbers are a readable sequence; the key is the credential);
 * - the correct key gets the card { order, invoice, return }.
 *
 * invoice is the STORED statutory card — { rows, totals } off the gst
 * module's gst_invoice row, the same core hsnSummary/summariseInvoice
 * shapes the Fastify card carries — and order.invoiceNumber is that row's
 * number. Served from the row rather than recomputed so the customer sees
 * the invoice that was actually issued. Orders that predate the gst module
 * (SIU-00001) have no row: invoice stays null and invoiceNumber stays null,
 * which the recorded contract allows — the read must not 500 on them.
 * return is null (returns are the M2 returns-ndr module). The order carries
 * the same field names the Fastify order row uses, with all money in
 * integer paise read the way the transport reads it (variant metadata
 * price_paise/mrp_paise first).
 *
 * A signed-in owner needs no key on the Fastify side; here the same grant
 * activates when Medusa's customer auth populates req.auth_context (the
 * phone-OTP auth provider is its own M1 work item) — the actor id IS the
 * customer id for actor_type "customer".
 */

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const number = req.params.number!;
  const rawKey = req.query.key;
  const key = typeof rawKey === "string" ? rawKey : undefined;

  // Malformed key: the 400 arm. Shaped like the Fastify zod-failure 400s.
  if ((rawKey !== undefined && typeof rawKey !== "string") ||
      (key !== undefined && !isWellFormedAccessKey(key))) {
    res.status(400).json({
      error: "invalid_request",
      message: "key: expected a UUID access key",
    });
    return;
  }

  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const pg = pgConnection as unknown as SqlClient;
  const identity = await findIdentityByNumber(pg, number);
  if (!identity) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const order = (await fetchOrders(req.scope, [identity.order_id])).get(identity.order_id);
  if (!order) {
    // An identity without its order — allocation ran but the order vanished.
    // To a guest that is indistinguishable from "no such order".
    res.status(404).json({ error: "not_found" });
    return;
  }

  // Owning the order (placed signed in, or claimed — auth plan phase 2) or
  // holding the key issued at checkout — the same two grants the Fastify
  // route honours. Everything else: 404.
  const actorId = (req as { auth_context?: { actor_id?: string } }).auth_context
    ?.actor_id;
  const isOwner = ownsOrder(actorId, identity, order);
  const holdsKey = key !== undefined && key === identity.access_key;
  if (!isOwner && !holdsKey) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.json(await orderCard(req.scope, identity, order));
}
