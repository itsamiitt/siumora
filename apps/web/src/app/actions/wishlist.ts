"use server";

import { revalidatePath } from "next/cache";

import { api } from "@/lib/api";
import { removeWishlist, toggleWishlist } from "@/lib/wishlist-store";

import { addToCart } from "./cart";

export interface WishlistResult {
  wishlisted: boolean;
  count: number;
}

export async function toggleWishlistItem(
  handle: string,
): Promise<WishlistResult> {
  const result = await toggleWishlist(handle);
  revalidatePath("/wishlist");
  return result;
}

export async function removeSavedItem(handle: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await removeWishlist(handle);
    revalidatePath("/wishlist");
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not remove this piece. Please try again." };
  }
}

export async function moveSavedToCart(
  handle: string,
  variantId: string,
): Promise<{ ok: boolean; moved: boolean; count: number; message?: string }> {
  try {
    // Check ownership of the variant and current stock before asking the cart
    // API to reserve it. The cart API checks stock again at write time.
    const detail = await api().getProduct(handle);
    const variant = detail?.product.variants.find((item) => item.id === variantId);
    if (!variant || variant.inventory < 1) {
      return { ok: false, moved: false, count: 0, message: "This option is no longer available." };
    }

    const added = await addToCart(variantId);
    if (!added.ok) {
      return { ok: false, moved: false, count: added.count, message: added.message };
    }
    try {
      await removeWishlist(handle);
      revalidatePath("/wishlist");
      return { ok: true, moved: true, count: added.count };
    } catch {
      return {
        ok: true,
        moved: false,
        count: added.count,
        message: "Added to bag, but could not remove it from Saved. You can remove it here.",
      };
    }
  } catch {
    return { ok: false, moved: false, count: 0, message: "Could not move this piece. Please try again." };
  }
}
