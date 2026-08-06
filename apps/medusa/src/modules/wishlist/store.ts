import type { WishlistStore } from "./wishlist";

/**
 * The pg-backed WishlistStore, in raw SQL against the shared pg connection
 * (ContainerRegistrationKeys.PG_CONNECTION — a knex client), the same
 * convention as siumora-order/allocate.ts. The generated module service is
 * not involved: every operation is one statement, and the idempotency the
 * toggle needs (a double-tap must not 500) is the database's ON CONFLICT,
 * not application bookkeeping.
 *
 * Deletes are hard deletes, mirroring the Fastify route: un-hearting a piece
 * removes the row, and toggling it back on re-inserts against the composite
 * primary key. Nothing writes deleted_at (the column is model.define
 * housekeeping), so reads do not filter on it — a filter would just be a
 * branch no data can take.
 */

/** Structural slice of knex so this file needs no knex type dependency. */
export interface SqlClient {
  raw(
    sql: string,
    bindings: ReadonlyArray<string>,
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export function pgWishlistStore(client: SqlClient): WishlistStore {
  return {
    async has(wishlistId, handle) {
      const result = await client.raw(
        `SELECT 1 FROM siumora_wishlists WHERE wishlist_id = ? AND handle = ?`,
        [wishlistId, handle],
      );
      return result.rows.length > 0;
    },

    async add(wishlistId, handle) {
      // ON CONFLICT DO NOTHING so a racing double-tap cannot 500 on the
      // primary key — the same guard the Fastify insert carries.
      await client.raw(
        `INSERT INTO siumora_wishlists (wishlist_id, handle, created_at, updated_at)
         VALUES (?, ?, now(), now())
         ON CONFLICT (wishlist_id, handle) DO NOTHING`,
        [wishlistId, handle],
      );
    },

    async remove(wishlistId, handle) {
      await client.raw(
        `DELETE FROM siumora_wishlists WHERE wishlist_id = ? AND handle = ?`,
        [wishlistId, handle],
      );
    },

    async handles(wishlistId) {
      // Oldest save first: the Fastify SELECT carries no ORDER BY and so
      // serves heap (insertion) order; created_at makes that order explicit
      // and stable here, with handle as a deterministic tiebreak.
      const result = await client.raw(
        `SELECT handle FROM siumora_wishlists
          WHERE wishlist_id = ?
          ORDER BY created_at, handle`,
        [wishlistId],
      );
      return result.rows.map((row) => String(row.handle));
    },
  };
}
