import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { pgWishlistStore, type SqlClient } from "../../../../../modules/wishlist/store";
import { isWellFormedWishlistId } from "../../../../../modules/wishlist/wishlist";

/**
 * GET /store/siumora/wishlists/:wishlistId — every saved handle.
 *
 * The Medusa port of the Fastify GET /wishlists/:wishlistId (apps/api/src/
 * routes/wishlist.ts): the id is an opaque uuid the storefront minted, so a
 * malformed one is the caller's bug (400 invalid_request, the zod-failure
 * shape), and an unknown-but-well-formed one is simply an empty list — a
 * wishlist exists the moment someone saves to it, so there is nothing to
 * 404. no-store because the heart states on the page must reflect the last
 * toggle, not a cache's memory of it.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const wishlistId = req.params.wishlistId!;
  if (!isWellFormedWishlistId(wishlistId)) {
    res.status(400).json({
      error: "invalid_request",
      message: "wishlistId: expected a UUID",
    });
    return;
  }

  const pg = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as SqlClient;
  const handles = await pgWishlistStore(pg).handles(wishlistId);

  res.setHeader("Cache-Control", "no-store");
  res.json({ handles });
}
