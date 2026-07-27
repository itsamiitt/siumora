"use server";

import { revalidatePath } from "next/cache";

import {
  addLine,
  clearCart,
  getCartLines,
  removeLine,
  setQuantity,
} from "@/lib/cart-store";

export interface CartActionResult {
  ok: boolean;
  message?: string;
  /**
   * Item count after the mutation.
   *
   * Returned so the header badge can update from the action's own result. A
   * follow-up fetch would race the Set-Cookie that creates the cart on a first
   * add, and would read back a count of zero.
   */
  count: number;
}

/**
 * Cart mutations.
 *
 * Each revalidates the paths that render cart state so the header count and the
 * cart page stay in step after a mutation from anywhere.
 */

function revalidateCartSurfaces() {
  revalidatePath("/cart");
  revalidatePath("/", "layout");
}

async function currentCount(): Promise<number> {
  const lines = await getCartLines();
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

export async function addToCart(
  variantId: string,
  quantity = 1,
): Promise<CartActionResult> {
  const result = await addLine(variantId, quantity);
  if (result.ok) revalidateCartSurfaces();
  return { ...result, count: await currentCount() };
}

export async function updateCartQuantity(
  variantId: string,
  quantity: number,
): Promise<CartActionResult> {
  const result = await setQuantity(variantId, quantity);
  if (result.ok) revalidateCartSurfaces();
  return { ...result, count: await currentCount() };
}

export async function removeFromCart(
  variantId: string,
): Promise<CartActionResult> {
  await removeLine(variantId);
  revalidateCartSurfaces();
  return { ok: true, count: await currentCount() };
}

export async function emptyCart(): Promise<CartActionResult> {
  await clearCart();
  revalidateCartSurfaces();
  return { ok: true, count: 0 };
}
