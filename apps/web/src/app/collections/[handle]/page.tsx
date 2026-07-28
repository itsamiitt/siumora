import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  applyFilters,
  materialFacets,
  parseFilters,
  priceFacets,
} from "@siumora/core";
import { collectionJsonLd, collectionMetadata } from "@siumora/seo";
import { Display } from "@siumora/ui";

import { JsonLdScript } from "@/components/json-ld";
import { ProductCard } from "@/components/product-card";
import { ProductFilters } from "@/components/product-filters";
import {
  getCollection,
  listCollections,
  listProductsInCollection,
} from "@/lib/catalog";

interface PageProps {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateStaticParams() {
  const collections = await listCollections();
  return collections.map((collection) => ({ handle: collection.handle }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { handle } = await params;
  const collection = await getCollection(handle);
  if (!collection) return {};

  return collectionMetadata(collection);
}

export default async function CollectionPage({ params, searchParams }: PageProps) {
  const { handle } = await params;
  const collection = await getCollection(handle);
  if (!collection) notFound();

  const all = await listProductsInCollection(handle);

  // Read from the URL, not from component state: a filtered collection has to
  // be shareable, bookmarkable and measurable.
  const filters = parseFilters(await searchParams);
  const products = applyFilters(all, filters);

  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      {/* Always the full collection, never the filtered view. Every filtered
          URL canonicalises to this page, so emitting a narrowed item list
          would describe one page two different ways. */}
      <JsonLdScript data={collectionJsonLd(collection, all)} />

      <header className="border-b border-[var(--color-rule)] pb-10 text-center">
        <Display as="h1" size="md">
          {collection.title}
        </Display>
        <p className="mx-auto mt-4 max-w-md text-content-muted">
          {collection.description}
        </p>
      </header>

      {/* Counts come from the unfiltered list, so an option never reads zero
          because of a choice made two filters ago. */}
      <ProductFilters
        materials={materialFacets(all)}
        prices={priceFacets(all)}
        total={all.length}
        showing={products.length}
      />

      {products.length > 0 ? (
        <div className="mt-12 grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4">
          {products.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              priority={index < 4}
            />
          ))}
        </div>
      ) : (
        <p className="mt-16 text-center text-content-muted">
          {all.length === 0
            ? "Nothing here yet. Something is on its way."
            : "Nothing matches those filters. Try widening one."}
        </p>
      )}
    </div>
  );
}
