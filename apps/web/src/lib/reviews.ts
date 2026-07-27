import "server-only";

import type { Review } from "@siumora/core";

import { api } from "./api";

/** Reviews for a product, newest first. Served with the product itself. */
export async function listReviews(productHandle: string): Promise<Review[]> {
  const result = await api().getProduct(productHandle, { revalidate: 60 });
  return [...(result?.reviews ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}
