"use server";

import { revalidatePath } from "next/cache";

import { toggleWishlist } from "@/lib/wishlist-store";

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
