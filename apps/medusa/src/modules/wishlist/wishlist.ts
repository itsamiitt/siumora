/**
 * Pure wishlist logic — no Medusa imports, so node --test can strip-type it
 * (same convention as siumora-order/identity.ts). The routes stay thin I/O;
 * the toggle decision and the id validation live here.
 *
 * The Fastify source of truth is apps/api/src/routes/wishlist.ts: a wishlist
 * is keyed by an opaque client-minted uuid the storefront keeps in a cookie,
 * and it stores products (handles), not variants — saving something for
 * later is an intent about the piece.
 */

/**
 * Wishlist-id shape check. The Fastify route gets this from zod's z.uuid()
 * and answers 400 invalid_request on failure; this regex accepts the same
 * values (RFC 4122-shaped, case-insensitive — the same expression the
 * siumora-order access-key check uses, duplicated rather than imported so
 * neither module reaches into the other).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isWellFormedWishlistId(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * What the toggle needs from storage, as four honest operations. The pg
 * implementation (store.ts) is raw SQL against the shared connection; the
 * unit tests run the same toggle against an in-memory store, so the on/off/
 * count behavior is proved without a database.
 */
export interface WishlistStore {
  has(wishlistId: string, handle: string): Promise<boolean>;
  /** Must be idempotent — a double-tap cannot error (ON CONFLICT DO NOTHING). */
  add(wishlistId: string, handle: string): Promise<void>;
  remove(wishlistId: string, handle: string): Promise<void>;
  /** Every saved handle, oldest save first (the order Fastify serves). */
  handles(wishlistId: string): Promise<string[]>;
}

/**
 * The toggle, exactly as the Fastify route does it: present → remove,
 * absent → add, then report what happened and how many remain. The count is
 * re-read after the write rather than derived, so a lost race still reports
 * the table's truth.
 */
export async function toggleWishlist(
  store: WishlistStore,
  wishlistId: string,
  handle: string,
): Promise<{ wishlisted: boolean; count: number }> {
  const existing = await store.has(wishlistId, handle);
  if (existing) {
    await store.remove(wishlistId, handle);
  } else {
    await store.add(wishlistId, handle);
  }
  const remaining = await store.handles(wishlistId);
  return { wishlisted: !existing, count: remaining.length };
}
