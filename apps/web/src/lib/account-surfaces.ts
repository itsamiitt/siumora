import "server-only";

import { revalidatePath } from "next/cache";

/**
 * Revalidate what changes when someone signs in, out, or changes number.
 *
 * Only the pages that read the session (or the bag and wishlist that sign-in
 * links to the account). The header is static — its bag count is client-side
 * — so revalidating the root layout would throw away every cached catalogue
 * page on each sign-in for nothing.
 */
export function revalidateAccountSurfaces(): void {
  revalidatePath("/account", "layout");
  revalidatePath("/admin", "layout");
  revalidatePath("/orders", "layout");
  revalidatePath("/coming-soon/admin");
  revalidatePath("/signin");
  revalidatePath("/cart");
  revalidatePath("/checkout");
  revalidatePath("/wishlist");
}
