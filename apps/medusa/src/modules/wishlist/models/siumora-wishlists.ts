import { model } from "@medusajs/framework/utils";

/**
 * One saved piece on one wishlist (design doc M2 storefront modules) — the
 * Medusa twin of the Fastify stack's `wishlist_items` table.
 *
 * - `wishlist_id` — the opaque uuid the storefront mints and keeps in an
 *   HTTP-only cookie. Not a customer id: wishlists work signed-out. Declared
 *   text here (DML has no uuid type); the hand-written migration makes the
 *   column uuid, and the routes refuse a non-uuid before it ever binds.
 * - `handle` — the product handle, where Fastify stores a product id and
 *   joins for the handle. A text reference, deliberately not a foreign key,
 *   per the module convention: module tables do not reach into Medusa-owned
 *   tables. Storing the handle keeps the read one table and matches what the
 *   wire serves ({handles: [...]}).
 * - Composite primary key (wishlist_id, handle) — the same "a piece is on a
 *   list once" invariant as Fastify's PK (wishlist_id, product_id), and the
 *   arbiter the toggle's ON CONFLICT insert leans on.
 *
 * created_at/updated_at/deleted_at come with model.define.
 */
export const SiumoraWishlists = model.define("siumora_wishlists", {
  wishlist_id: model.text().primaryKey(),
  handle: model.text().primaryKey(),
});
