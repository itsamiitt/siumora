import { model } from "@medusajs/framework/utils";

/**
 * A return request against a Medusa order (design doc M2 · returns-ndr) —
 * the Fastify return_requests table (packages/db/src/schema.ts) as a
 * module-owned table.
 *
 * The invariant lives in the database, copied from the Fastify migration
 * (packages/db/src/migrate.ts `returns_one_open_per_order`): at most one
 * open return per order, enforced by a partial unique index on order_id
 * WHERE status <> 'rejected' (hand-added in this module's migration — a
 * second open return would refund the same piece twice).
 *
 * `seal_intact` is stored here where Fastify only evaluated it, so the
 * hygiene answer the customer gave survives for the quality check on
 * receipt. The reverse-pickup and payout columns are NOT here: reverse
 * pickup is the M3 Shiprocket port, and the payout-once rail (reference +
 * audit) is its own M2 work item that extends this table when it lands.
 */
export const SiumoraReturnRequest = model.define("siumora_return_requests", {
  id: model.id({ prefix: "siret" }).primaryKey(),
  order_id: model.text(),
  status: model.text(),
  reason: model.text(),
  resolution: model.text(),
  variant_ids: model.json(),
  refund_to: model.text(),
  free_return_shipping: model.boolean().default(false),
  seal_intact: model.boolean().nullable(),
  note: model.text().nullable(),
});
