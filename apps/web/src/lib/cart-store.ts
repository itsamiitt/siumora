import "server-only";

import { cookies } from "next/headers";

import type { CartLine } from "@siumora/core";

import { findVariant } from "./catalog";

/**
 * Cart persistence.
 *
 * Phase 2 keeps carts in a module-level map keyed by a cart id held in an
 * HTTP-only cookie. That is the same shape Medusa's cart API exposes — a server
 * id plus a cookie — so replacing this file with SDK calls does not touch any
 * caller. It is deliberately not durable: a server restart empties it, which is
 * acceptable before there is a database and unacceptable after.
 */

const CART_COOKIE = "siumora_cart";

/** Stored rather than derived so a price change cannot silently reprice a cart. */
interface StoredLine {
  variantId: string;
  quantity: number;
}

/**
 * Pinned to globalThis, not a plain module constant.
 *
 * Next bundles route handlers separately from pages, so a module-level Map is
 * instantiated more than once and the two copies diverge: the cart page reads
 * its lines while /api/cart/count reads an empty map and reports zero items.
 * One global slot keeps every bundle on the same store.
 */
const globalForCarts = globalThis as typeof globalThis & {
  __siumoraCarts?: Map<string, StoredLine[]>;
};

const CARTS: Map<string, StoredLine[]> = (globalForCarts.__siumoraCarts ??=
  new Map<string, StoredLine[]>());

async function readCartId(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(CART_COOKIE)?.value;
}

/**
 * Read the cart id, creating one if absent.
 *
 * Only callable from a Server Action or Route Handler — Next forbids setting
 * cookies while rendering.
 */
async function ensureCartId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(CART_COOKIE)?.value;
  if (existing) return existing;

  const id = crypto.randomUUID();
  store.set(CART_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return id;
}

/**
 * Resolve stored lines into full cart lines.
 *
 * Prices come from the catalogue at read time, so a variant that disappears
 * drops out of the cart rather than rendering with a stale price.
 */
export async function getCartLines(): Promise<CartLine[]> {
  const id = await readCartId();
  if (!id) return [];

  const stored = CARTS.get(id) ?? [];
  const lines: CartLine[] = [];

  for (const entry of stored) {
    const resolved = await resolveLine(entry);
    if (resolved) lines.push(resolved);
  }
  return lines;
}

async function resolveLine(entry: StoredLine): Promise<CartLine | null> {
  const found = await findVariant(entry.variantId);
  if (!found) return null;

  const { product, variant } = found;
  return {
    variantId: variant.id,
    sku: variant.sku,
    productHandle: product.handle,
    title: product.title,
    variantTitle: variant.title,
    imageUrl: product.images[0]!.url,
    mrp: variant.price.mrp,
    unitPrice: variant.price.selling,
    quantity: entry.quantity,
    gstSlab: product.gstSlab,
    hsn: product.hsn,
    piercedJewellery: product.piercedJewellery,
  };
}

/** Available stock for a variant, or 0 when it no longer exists. */
async function availableStock(variantId: string): Promise<number> {
  const found = await findVariant(variantId);
  return found?.variant.inventory ?? 0;
}

export async function addLine(
  variantId: string,
  quantity = 1,
): Promise<{ ok: boolean; message?: string }> {
  const stock = await availableStock(variantId);
  if (stock <= 0) return { ok: false, message: "That option is sold out." };

  const id = await ensureCartId();
  const lines = CARTS.get(id) ?? [];
  const existing = lines.find((l) => l.variantId === variantId);

  // Never let the cart exceed what can actually be shipped.
  const desired = (existing?.quantity ?? 0) + quantity;
  if (desired > stock) {
    return { ok: false, message: `Only ${stock} left.` };
  }

  if (existing) existing.quantity = desired;
  else lines.push({ variantId, quantity });

  CARTS.set(id, lines);
  return { ok: true };
}

export async function setQuantity(
  variantId: string,
  quantity: number,
): Promise<{ ok: boolean; message?: string }> {
  const id = await ensureCartId();
  const lines = CARTS.get(id) ?? [];

  if (quantity <= 0) {
    CARTS.set(
      id,
      lines.filter((l) => l.variantId !== variantId),
    );
    return { ok: true };
  }

  const stock = await availableStock(variantId);
  if (quantity > stock) return { ok: false, message: `Only ${stock} left.` };

  const existing = lines.find((l) => l.variantId === variantId);
  if (existing) existing.quantity = quantity;
  else lines.push({ variantId, quantity });

  CARTS.set(id, lines);
  return { ok: true };
}

export async function removeLine(variantId: string): Promise<void> {
  await setQuantity(variantId, 0);
}

export async function clearCart(): Promise<void> {
  const id = await readCartId();
  if (id) CARTS.delete(id);
}
