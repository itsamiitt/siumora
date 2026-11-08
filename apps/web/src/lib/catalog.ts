import "server-only";

import type { Collection, Product, Review, Variant } from "@siumora/core";

import type { CatalogCategory } from "@siumora/sdk/medusa";

import { categoryBranch, nonEmptyCategories } from "@/components/site-navigation";

import { api } from "./api";

/**
 * Catalogue reads.
 *
 * Backed by the commerce API rather than a fixture. The signatures are
 * unchanged from the fixture version on purpose — every page, metadata builder
 * and sitemap that called them keeps working.
 *
 * Catalogue data is public and changes rarely, so reads are revalidated on a
 * short interval rather than fetched fresh on every render.
 */

const CATALOG_REVALIDATE_SECONDS = 5;

export async function listProducts(): Promise<Product[]> {
  return api().listProducts({}, { revalidate: CATALOG_REVALIDATE_SECONDS });
}

export async function listRecentProducts(limit = 8): Promise<Product[]> {
  return api().listProducts(
    { limit },
    { revalidate: CATALOG_REVALIDATE_SECONDS },
  );
}

export async function getProduct(handle: string): Promise<Product | undefined> {
  const result = await api().getProduct(handle, {
    revalidate: CATALOG_REVALIDATE_SECONDS,
  });
  return result?.product;
}

/** Product plus its reviews, so a PDP needs one round trip rather than two. */
export async function getProductWithReviews(
  handle: string,
): Promise<{ product: Product; reviews: Review[] } | undefined> {
  const result = await api().getProduct(handle, {
    revalidate: CATALOG_REVALIDATE_SECONDS,
  });
  return result ? { product: result.product, reviews: result.reviews } : undefined;
}

export async function listCollections(): Promise<Collection[]> {
  return api().listCollections({ revalidate: CATALOG_REVALIDATE_SECONDS });
}

export async function getCollection(
  handle: string,
): Promise<Collection | undefined> {
  const all = await listCollections();
  return all.find((collection) => collection.handle === handle);
}

export async function listProductsInCollection(
  handle: string,
): Promise<Product[]> {
  return api().listProducts(
    { collection: handle },
    { revalidate: CATALOG_REVALIDATE_SECONDS },
  );
}

export async function findVariant(
  variantId: string,
): Promise<{ product: Product; variant: Variant } | undefined> {
  for (const product of await listProducts()) {
    const variant = product.variants.find((v) => v.id === variantId);
    if (variant) return { product, variant };
  }
  return undefined;
}

/**
 * Every active, public category the store API returns (Medusa only),
 * including empty ones — for resolving a /shop?category= link.
 */
export async function listAllCategories(): Promise<CatalogCategory[]> {
  const client = api();
  return "listCategories" in client
    ? client.listCategories({ revalidate: CATALOG_REVALIDATE_SECONDS }) : [];
}

/** Categories worth a navigation link: those with a listable product in or beneath them. */
export async function listCategories(): Promise<CatalogCategory[]> {
  const categories = await listAllCategories();
  if (categories.length === 0) return categories;
  return nonEmptyCategories(categories, await listProducts());
}

/** Products in a category and everything beneath it. */
export async function listProductsInCategory(
  category: Pick<CatalogCategory, "id">,
  categories: readonly CatalogCategory[],
): Promise<Product[]> {
  const client = api();
  return "listProductsInCategory" in client
    ? client.listProductsInCategory(categoryBranch(categories, category.id), { revalidate: CATALOG_REVALIDATE_SECONDS })
    : [];
}
