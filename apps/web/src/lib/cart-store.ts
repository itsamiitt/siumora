import "server-only";

import { cookies } from "next/headers";

import type { CartLine } from "@siumora/core";

import { api } from "./api";

/**
 * Cart.
 *
 * The cart itself lives in the API and the database; this module only carries
 * the cart id in an HTTP-only cookie. Keeping the id server-side means a
 * client cannot adopt someone else's cart by editing localStorage, and the
 * totals a shopper sees are always the ones the server computed.
 */

const CART_COOKIE = "siumora_cart";

async function readCartId(): Promise<string | undefined> {
  return (await cookies()).get(CART_COOKIE)?.value;
}

/**
 * Read the cart id, creating a cart if there is none.
 *
 * Only callable from a Server Action or Route Handler — Next forbids setting
 * cookies during render.
 */
async function ensureCartId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(CART_COOKIE)?.value;
  if (existing) return existing;

  const id = await api().createCart();
  store.set(CART_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return id;
}

export async function getCartLines(): Promise<CartLine[]> {
  const id = await readCartId();
  if (!id) return [];

  try {
    return (await api().getCart(id)).lines;
  } catch {
    // A cart the API no longer knows about — expired, or a database reset —
    // reads as empty rather than breaking the page.
    return [];
  }
}

export async function addLine(
  variantId: string,
  quantity = 1,
): Promise<{ ok: boolean; message?: string }> {
  const id = await ensureCartId();
  try {
    await api().addToCart(id, variantId, quantity);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: messageFor(error) };
  }
}

export async function setQuantity(
  variantId: string,
  quantity: number,
): Promise<{ ok: boolean; message?: string }> {
  const id = await ensureCartId();
  try {
    await api().setCartQuantity(id, variantId, quantity);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: messageFor(error) };
  }
}

export async function removeLine(variantId: string): Promise<void> {
  await setQuantity(variantId, 0);
}

export async function clearCart(): Promise<void> {
  const id = await readCartId();
  if (id) await api().clearCart(id);
}

/** The cart id, for the checkout call. */
export async function currentCartId(): Promise<string | undefined> {
  return readCartId();
}

/** Surface the API's own message — "Only 2 left" is more use than a status. */
function messageFor(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Could not update the bag.";
}
