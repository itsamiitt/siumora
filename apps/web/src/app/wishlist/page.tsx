import type { Metadata } from "next";
import Link from "next/link";

import { Display, MicroLabel } from "@siumora/ui";

import { ProductCard } from "@/components/product-card";
import { getProduct } from "@/lib/catalog";
import { listWishlist } from "@/lib/wishlist-store";

export const metadata: Metadata = {
  title: "Saved",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function WishlistPage() {
  const handles = await listWishlist();
  const products = (
    await Promise.all(handles.map((handle) => getProduct(handle)))
  ).filter((product) => product !== undefined);

  if (products.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-5 py-32 text-center">
        <Display as="h1" size="sm">
          Nothing saved yet.
        </Display>
        <p className="mt-4 text-content-muted">
          Save a piece and it waits here for you.
        </p>
        <Link
          href="/collections/everyday"
          className="mt-8 border-b border-content pb-1 transition-colors hover:border-accent-ink hover:text-accent-ink"
        >
          <MicroLabel>Shop everyday</MicroLabel>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <Display as="h1" size="sm">
        Saved
      </Display>

      <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </div>
  );
}
