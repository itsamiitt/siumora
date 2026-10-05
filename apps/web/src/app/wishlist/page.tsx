import { Suspense } from "react";

import type { Metadata } from "next";
import Loading from "./loading";
import Link from "next/link";

import { Display, MicroLabel } from "@siumora/ui";

import { ProductCard } from "@/components/product-card";
import { SavedItemActions } from "@/components/saved-item-actions";
import { getProduct } from "@/lib/catalog";
import { listWishlist } from "@/lib/wishlist-store";

export const metadata: Metadata = {
  title: "Saved",
  robots: { index: false, follow: false },
};


async function WishlistPageContents() {
  let entries: Array<{
    handle: string;
    product: Awaited<ReturnType<typeof getProduct>>;
  }>;
  try {
    const handles = await listWishlist();
    entries = await Promise.all(
      handles.map(async (handle) => ({ handle, product: await getProduct(handle) })),
    );
  } catch {
    return (
      <div className="mx-auto max-w-md px-5 py-32 text-center">
        <Display as="h1" size="sm">
          Saved
        </Display>
        <p role="alert" className="mt-4 text-content-muted">
          We could not load your saved pieces right now. Please try again shortly.
        </p>
        <form action="/wishlist" method="get" className="mt-6">
          <button type="submit" className="min-h-11 underline underline-offset-4">
            Try again
          </button>
        </form>
      </div>
    );
  }

  if (entries.length === 0) {
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
        {entries.map(({ handle, product }, index) => (
          <div key={handle}>
            {product ? (
              <ProductCard product={product} priority={index < 4} />
            ) : (
              <div className="flex aspect-4/5 flex-col justify-end border border-[var(--color-rule)] bg-ground-raised p-5">
                <p className="text-sm text-content-muted">This saved piece is no longer available.</p>
              </div>
            )}
            <SavedItemActions
              handle={handle}
              title={product?.title ?? handle}
              variants={product?.variants ?? []}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Static shell. The dynamic read — cookies, and the session behind them —
 * happens inside the boundary, so the rest of the route still prerenders and
 * the hole streams in.
 */
export default function WishlistPage() {
  return (
    <Suspense fallback={<Loading />}>
      <WishlistPageContents />
    </Suspense>
  );
}
