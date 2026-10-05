import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { pgWishlistStore, type SqlClient } from "../../../../../../../modules/wishlist/store";
import { isWellFormedWishlistId } from "../../../../../../../modules/wishlist/wishlist";

/** Idempotent removal so a repeated move-to-bag cannot re-save a product. */
export async function DELETE(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const wishlistId = req.params.wishlistId!;
  const handle = req.params.handle!;
  if (!isWellFormedWishlistId(wishlistId) || !handle) {
    res.status(400).json({ error: "invalid_request", message: "A wishlist and product are required." });
    return;
  }

  const pg = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as SqlClient;
  const store = pgWishlistStore(pg);
  await store.remove(wishlistId, handle);
  const handles = await store.handles(wishlistId);
  res.setHeader("Cache-Control", "no-store");
  res.json({ count: handles.length });
}
