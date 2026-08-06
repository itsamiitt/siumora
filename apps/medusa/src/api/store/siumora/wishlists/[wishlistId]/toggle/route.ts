import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { pgWishlistStore, type SqlClient } from "../../../../../../modules/wishlist/store";
import {
  isWellFormedWishlistId,
  toggleWishlist,
} from "../../../../../../modules/wishlist/wishlist";

/**
 * POST /store/siumora/wishlists/:wishlistId/toggle {handle} — save or unsave.
 *
 * The Medusa port of the Fastify toggle (apps/api/src/routes/wishlist.ts),
 * with the same gates in the same order:
 * 1. malformed wishlist id → 400 invalid_request (zod-failure shape);
 * 2. missing/empty handle → 400 invalid_request;
 * 3. handle not in the catalogue → 404 not_found — a wishlist stores real
 *    pieces, not arbitrary strings (Fastify proves this against its products
 *    table; here the same proof runs through query.graph);
 * 4. otherwise toggle and answer { wishlisted, count } — the recorded
 *    contract's exact keys.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const wishlistId = req.params.wishlistId!;
  if (!isWellFormedWishlistId(wishlistId)) {
    res.status(400).json({
      error: "invalid_request",
      message: "wishlistId: expected a UUID",
    });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const handle = body.handle;
  if (typeof handle !== "string" || handle.length === 0) {
    res.status(400).json({
      error: "invalid_request",
      message: "handle: expected a non-empty string",
    });
    return;
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id"],
    filters: { handle },
  });
  if (!products[0]) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const pg = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as SqlClient;
  res.json(await toggleWishlist(pgWishlistStore(pg), wishlistId, handle));
}
