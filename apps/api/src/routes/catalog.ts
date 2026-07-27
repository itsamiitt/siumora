import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { searchProducts, summariseRatings, type Product } from "@siumora/core";
import { eq, getProduct, listProducts, schema } from "@siumora/db";

/**
 * Catalogue reads.
 *
 * Public and cacheable. The shapes match what `packages/core` already models,
 * so the storefront consumes them without a translation layer.
 */

/** Map a database row to the domain shape core already validates. */
function toDomain(row: Awaited<ReturnType<typeof listProducts>>[number]): Product {
  return {
    id: row.id,
    handle: row.handle,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    hsn: row.hsn,
    gstSlab: row.gstSlab as Product["gstSlab"],
    material: row.material,
    piercedJewellery: row.piercedJewellery,
    images: (row.images as Product["images"]) ?? [],
    collections: row.collections,
    variants: row.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      title: variant.title,
      price: { mrp: variant.mrp, selling: variant.price },
      inventory: variant.inventory,
    })),
  };
}

export async function registerCatalogRoutes(server: FastifyInstance) {
  server.get("/products", async (request, reply) => {
    const query = z
      .object({ collection: z.string().optional(), q: z.string().optional() })
      .parse(request.query);

    const rows = await listProducts(server.db);
    let items = rows.map(toDomain);

    if (query.collection) {
      items = items.filter((p) => p.collections.includes(query.collection!));
    }
    if (query.q) {
      items = searchProducts(items, query.q).map((hit) => hit.product);
    }

    // Catalogue data is public and changes rarely; letting the CDN hold it
    // keeps the origin out of the path for most reads.
    reply.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return { products: items };
  });

  server.get("/products/:handle", async (request, reply) => {
    const { handle } = z.object({ handle: z.string() }).parse(request.params);

    const row = await getProduct(server.db, handle);
    if (!row) return reply.code(404).send({ error: "not_found" });

    const product = toDomain(row);
    const reviewRows = await server.db
      .select()
      .from(schema.reviews)
      .where(eq(schema.reviews.productId, product.id));

    const reviews = reviewRows.map((review) => ({
      id: review.id,
      productHandle: product.handle,
      rating: review.rating,
      title: review.title,
      body: review.body,
      authorName: review.authorName,
      verifiedBuyer: review.verifiedBuyer,
      createdAt: review.createdAt.toISOString(),
    }));

    reply.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return { product, reviews, rating: summariseRatings(reviews) };
  });

  server.get("/collections", async (_request, reply) => {
    const rows = await server.db.select().from(schema.collections);
    reply.header("Cache-Control", "public, max-age=300");
    return { collections: rows };
  });

  server.get("/pincodes/:pincode", async (request, reply) => {
    const { pincode } = z
      .object({ pincode: z.string().regex(/^[1-9]\d{5}$/) })
      .parse(request.params);

    const [row] = await server.db
      .select()
      .from(schema.pincodeServiceability)
      .where(eq(schema.pincodeServiceability.pincode, pincode));

    if (!row) {
      // An unknown pincode is not an error — it is simply one the courier has
      // not told us about, and it must not be reported as serviceable.
      return {
        pincode,
        serviceable: false,
        codAvailable: false,
        estimatedDays: "—",
        rtoRateBps: 0,
      };
    }

    reply.header("Cache-Control", "public, max-age=3600");
    return row;
  });
}
