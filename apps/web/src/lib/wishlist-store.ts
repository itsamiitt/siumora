import "server-only";

import { cookies } from "next/headers";

import { api } from "./api";

/**
 * Wishlist.
 *
 * Stored in the database and keyed by an id in an HTTP-only cookie, the same
 * arrangement as the cart. Saves therefore survive a browser change once
 * sign-in links the id to a customer.
 */

const WISHLIST_COOKIE = "siumora_wishlist";

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
  try {
    return await api().getWishlist(id);
  } catch {
    return [];
  }
}

export async function isWishlisted(handle: string): Promise<boolean> {
  return (await listWishlist()).includes(handle);
}

export async function toggleWishlist(
  handle: string,
): Promise<{ wishlisted: boolean; count: number }> {
  const id = await ensureId();
  return api().toggleWishlist(id, handle);
}
