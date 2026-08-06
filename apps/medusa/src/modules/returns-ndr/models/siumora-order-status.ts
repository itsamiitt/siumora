import { model } from "@medusajs/framework/utils";

/**
 * The Siumora status machine state of a Medusa order (design doc M2 ·
 * returns-ndr). One row per order, lazily created (see data.ts header):
 *
 * - `order_id` — the Medusa order id. A text reference, deliberately not a
 *   foreign key, per the design doc's convention: module tables do not reach
 *   into Medusa-owned tables. Unique — one status per order; the lazy insert
 *   uses it as its ON CONFLICT arbiter.
 * - `status` — a @siumora/core OrderStatus. Until real couriers land in M3
 *   (Shiprocket webhooks driving Medusa fulfillments), this column IS the
 *   status truth the storefront reads; transitions are validated against
 *   core's canTransition and, for courier moves, gated by the courier
 *   simulation exactly as the Fastify dev stack gates them.
 * - `ndr_reason` — why the latest delivery attempt failed; never cleared on
 *   recovery so the history stays readable (Fastify keeps the same column on
 *   its orders table).
 *
 * updated_at doubles as the delivered-at timestamp while status is
 * "delivered" — delivered's only outward transition is "returned", so the
 * moment it was written is the moment the returns clock started.
 */
export const SiumoraOrderStatus = model.define("siumora_order_status", {
  id: model.id({ prefix: "siost" }).primaryKey(),
  order_id: model.text().unique(),
  status: model.text(),
  ndr_reason: model.text().nullable(),
});
