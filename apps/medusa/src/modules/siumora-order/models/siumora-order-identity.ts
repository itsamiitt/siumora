import { model } from "@medusajs/framework/utils";

/**
 * The Siumora identity of a Medusa order (design doc M1: "the order-number +
 * guest accessKey model ported as a Medusa customization").
 *
 * One row per placed order:
 * - `order_id` — the Medusa order id. A text reference, deliberately not a
 *   foreign key, per the design doc's outbox convention: module tables do not
 *   reach into Medusa-owned tables. Unique — one identity per order, and the
 *   allocation insert uses it as its ON CONFLICT arbiter.
 * - `order_number` — the customer-facing SIU-XXXXX number. Allocated from a
 *   Postgres sequence inside the INSERT itself (see allocate.ts for the
 *   concurrency disposition), unique-enforced by the database.
 * - `access_key` — a UUID minted at allocation. Order numbers are a readable
 *   sequence, so knowing one proves nothing; this key is what authorises a
 *   guest to read their own order (same model as the Fastify orders table).
 * - `idempotency_key` — the checkout Idempotency-Key header, when one was
 *   sent. Unique so the same key can never mint two orders; a replay finds
 *   this row and returns the original order.
 * - `cart_id` — the cart the order was completed from. Lets a replay detect
 *   the Fastify 422 case: same idempotency key, different request.
 *
 * created_at/updated_at/deleted_at come with model.define.
 */
export const SiumoraOrderIdentity = model.define("siumora_order_identity", {
  id: model.id({ prefix: "sioid" }).primaryKey(),
  order_id: model.text().unique(),
  cart_id: model.text().nullable(),
  order_number: model.text().unique(),
  access_key: model.text(),
  idempotency_key: model.text().unique().nullable(),
});
