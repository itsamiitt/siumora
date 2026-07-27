import "server-only";

import { cookies } from "next/headers";

/**
 * Wishlist.
 *
 * Held per visitor by the same cookie-plus-server-map arrangement as the cart,
 * and pinned to globalThis for the same reason: Next bundles route handlers
 * separately from pages, so a plain module constant is instantiated twice and
 * the two copies silently diverge.
 *
 * Stores product handles rather than variant ids. Saving something for later is
 * an intent about the piece, not about the size or finish, and forcing a
 * variant choice at save time loses saves.
 */

const WISHLIST_COOKIE = "siumora_wishlist";

const globalForWishlists = globalThis as typeof globalThis & {
  __siumoraWishlists?: Map<string, Set<string>>;
};

const WISHLISTS: Map<string, Set<string>> = (globalForWishlists.__siumoraWishlists ??=
  new Map());

async function readId(): Promise<string | undefined> {
  return (await cookies()).get(WISHLIST_COOKIE)?.value;
}

async function ensureId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(WISHLIST_COOKIE)?.value;
  if (existing) return existing;

  const id = crypto.randomUUID();
  store.set(WISHLIST_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  return id;
}

export async function listWishlist(): Promise<string[]> {
  const id = await readId();
  if (!id) return [];
  return [...(WISHLISTS.get(id) ?? [])];
}

export async function isWishlisted(handle: string): Promise<boolean> {
  const id = await readId();
  return id ? (WISHLISTS.get(id)?.has(handle) ?? false) : false;
}

/** Toggle and report the resulting state, so the caller needs no second read. */
export async function toggleWishlist(
  handle: string,
): Promise<{ wishlisted: boolean; count: number }> {
  const id = await ensureId();
  const set = WISHLISTS.get(id) ?? new Set<string>();

  const wishlisted = !set.has(handle);
  if (wishlisted) set.add(handle);
  else set.delete(handle);

  WISHLISTS.set(id, set);
  return { wishlisted, count: set.size };
}
