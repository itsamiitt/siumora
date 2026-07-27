import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { and, eq, schema } from "@siumora/db";

/**
 * Wishlist.
 *
 * Keyed by an opaque id the storefront keeps in an HTTP-only cookie. Stores
 * products rather than variants: saving something for later is an intent about
 * the piece, and making someone choose a finish to save it loses saves.
 */

const params = z.object({ wishlistId: z.uuid() });

export async function registerWishlistRoutes(server: FastifyInstance) {
  server.get("/wishlists/:wishlistId", async (request, reply) => {
    const { wishlistId } = params.parse(request.params);

    const rows = await server.db
      .select({ handle: schema.products.handle })
      .from(schema.wishlistItems)
      .innerJoin(
        schema.products,
        eq(schema.products.id, schema.wishlistItems.productId),
      )
      .where(eq(schema.wishlistItems.wishlistId, wishlistId));

    reply.header("Cache-Control", "no-store");
    return { handles: rows.map((row) => row.handle) };
  });

  server.post("/wishlists/:wishlistId/toggle", async (request, reply) => {
    const { wishlistId } = params.parse(request.params);
    const { handle } = z.object({ handle: z.string().min(1) }).parse(request.body);

    const [product] = await server.db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(eq(schema.products.handle, handle));

    if (!product) return reply.code(404).send({ error: "not_found" });

    const [existing] = await server.db
      .select()
      .from(schema.wishlistItems)
      .where(
        and(
          eq(schema.wishlistItems.wishlistId, wishlistId),
          eq(schema.wishlistItems.productId, product.id),
        ),
      );

    if (existing) {
      await server.db
        .delete(schema.wishlistItems)
        .where(
          and(
            eq(schema.wishlistItems.wishlistId, wishlistId),
            eq(schema.wishlistItems.productId, product.id),
          ),
        );
    } else {
      // onConflictDoNothing so a double-tap cannot 500 on the primary key.
      await server.db
        .insert(schema.wishlistItems)
        .values({ wishlistId, productId: product.id })
        .onConflictDoNothing();
    }

    const remaining = await server.db
      .select()
      .from(schema.wishlistItems)
      .where(eq(schema.wishlistItems.wishlistId, wishlistId));

    return { wishlisted: !existing, count: remaining.length };
  });
}
