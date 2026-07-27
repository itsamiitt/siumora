import type { Metadata } from "next";
import Link from "next/link";

import { searchProducts } from "@siumora/core";
import { Display, MicroLabel } from "@siumora/ui";

import { ProductCard } from "@/components/product-card";
import { SearchInput } from "@/components/search-input";
import { listProducts } from "@/lib/catalog";

export const metadata: Metadata = {
  title: "Search",
  // Search result pages are thin and near-infinite; indexing them competes
  // with the collection pages that are meant to rank.
  robots: { index: false, follow: true },
};

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function SearchPage({ searchParams }: PageProps) {
  const { q = "" } = await searchParams;
  const query = q.trim();

  const products = await listProducts();
  const hits = query ? searchProducts(products, query) : [];

  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <Display as="h1" size="sm">
        Search
      </Display>

      <div className="mt-7 max-w-md">
        <SearchInput initialQuery={query} />
      </div>

      {query && (
        <p className="mt-6 text-sm text-ink-muted">
          {hits.length === 0
            ? `Nothing matches “${query}”.`
            : `${hits.length} ${hits.length === 1 ? "piece" : "pieces"} for “${query}”`}
        </p>
      )}

      {hits.length > 0 && (
        <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4">
          {hits.map((hit) => (
            <ProductCard key={hit.product.id} product={hit.product} />
          ))}
        </div>
      )}

      {/* A dead end is a lost sale, so an empty result always offers a way on. */}
      {query && hits.length === 0 && (
        <div className="mt-8">
          <p className="text-sm text-ink-muted">
            Try a different word, or start here.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {["Everyday", "Gifting", "The Petal Edit"].map((name) => (
              <Link
                key={name}
                href={`/collections/${name.toLowerCase().replace(/\s+/g, "-")}`}
                className="border border-ink/20 px-4 py-2 transition-colors hover:border-mulberry hover:text-mulberry"
              >
                <MicroLabel>{name}</MicroLabel>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
