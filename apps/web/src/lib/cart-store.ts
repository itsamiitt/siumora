import "server-only";

import { cookies } from "next/headers";

import type { CartLine } from "@siumora/core";
import { ApiError } from "@siumora/sdk";

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
  const existing = await readCartId();
  return existing ?? startCart();
}

/** A fresh cart, pointed at by this browser from now on. */
async function startCart(): Promise<string> {
  const id = await api().createCart();
  (await cookies()).set(CART_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return id;
}

/**
 * The cookie names a cart that is no more — expired, reset, or already an
 * order (the transport answers a completed cart as 404 too). Such an id is
 * useless forever, so it is dropped rather than retried.
 */
function cartIsGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/**
 * The cart lines and the coupon codes on it (plan 16 B19) in one read — the
 * checkout page shows both. Lines carry each coupon's discount.
 */
export async function getCartView(): Promise<{ lines: CartLine[]; coupons: string[] }> {
  const id = await readCartId();
  if (!id) return { lines: [], coupons: [] };
  try {
    const cart = await api().getCart(id);
    return { lines: cart.lines, coupons: cart.coupons ?? [] };
  } catch {
    return { lines: [], coupons: [] };
  }
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
  try {
    const id = await ensureCartId();
    try {
      await api().addToCart(id, variantId, quantity);
    } catch (error) {
      if (!cartIsGone(error)) throw error;
      // A stale cookie (the bag became an order, or expired): start a new
      // bag and try the add once more, so the shopper never sees the seam.
      await api().addToCart(await startCart(), variantId, quantity);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: messageFor(error) };
  }
}

export async function setQuantity(
  variantId: string,
  quantity: number,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const id = await ensureCartId();
    await api().setCartQuantity(id, variantId, quantity);
    return { ok: true };
  } catch (error) {
    if (cartIsGone(error)) {
      // Nothing to change on a bag that is gone; the next add starts afresh.
      await forgetCart();
      return { ok: false, message: "Your bag has expired. Add the piece again." };
    }
    return { ok: false, message: messageFor(error) };
  }
}

export async function removeLine(variantId: string): Promise<void> {
  await setQuantity(variantId, 0);
}

export async function clearCart(): Promise<void> {
  const id = await readCartId();
  if (!id) return;
  try {
    await api().clearCart(id);
  } catch (error) {
    // A bag that is already gone is as empty as it gets.
    if (!cartIsGone(error)) throw error;
    await forgetCart();
  }
}

/**
 * Let go of a cart that became an order. Both backends close the cart as
 * part of placing the order (Fastify empties it in the order transaction,
 * Medusa completes it), so the browser only needs to stop pointing at it;
 * the next add creates a fresh one. Mutating a completed Medusa cart would
 * fail after the order already stands. Only callable from a Server Action.
 */
export async function forgetCart(): Promise<void> {
  (await cookies()).delete(CART_COOKIE);
}

/** The cart id, for the checkout call. */
export async function currentCartId(): Promise<string | undefined> {
  return readCartId();
}

/**
 * Surface the API's own refusal — "Only 2 left" is more use than a status —
 * but not a transport failure: "fetch failed" or a 5xx body means nothing
 * to a shopper, and the bag is simply unreachable for a moment.
 */
function messageFor(error: unknown): string {
  return error instanceof ApiError && error.status < 500 && error.message
    ? error.message
    : "We could not reach your bag just now. Please try again.";
}

/**
 * Tie this browser's bag to the account that just signed in (auth plan
 * phase 2): the API transfers it to the customer and folds in bags left on
 * other devices, or hands back the account's latest bag when this browser
 * has none. Only callable from a Server Action — it may set the cookie.
 */
export async function linkCartToAccount(client: {
  linkCart(cartId?: string): Promise<{ cartId: string | null }>;
}): Promise<void> {
  const current = await readCartId();
  const { cartId } = await client.linkCart(current);
  if (cartId && cartId !== current) {
    (await cookies()).set(CART_COOKIE, cartId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
}

/**
 * Put a known cart on this browser — the cart-reminder link (plan 16 B22),
 * after the API has checked the link's signature and that the cart is still
 * open. Replaces whatever bag this browser had: the link names the one the
 * shopper meant.
 */
export async function adoptCart(cartId: string): Promise<void> {
  (await cookies()).set(CART_COOKIE, cartId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}
