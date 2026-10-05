import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  applyFilters,
  filtersToQuery,
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

const PAGE_SIZE = 24;

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
  const query = await searchParams;
  const filters = parseFilters(query);
  const products = applyFilters(all, filters);
  const pageCount = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const rawPage = Array.isArray(query.page) ? query.page[0] : query.page;
  const requestedPage = rawPage && /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : 1;
  const page = Number.isSafeInteger(requestedPage)
    ? Math.min(requestedPage, pageCount)
    : 1;
  const start = (page - 1) * PAGE_SIZE;
  const visible = products.slice(start, start + PAGE_SIZE);
  const pageHref = (number: number) => {
    const params = new URLSearchParams(filtersToQuery(filters));
    if (number > 1) params.set("page", String(number));
    const suffix = params.toString();
    return `/collections/${encodeURIComponent(handle)}${suffix ? `?${suffix}` : ""}`;
  };
  if (rawPage !== undefined && (page === 1 || rawPage !== String(page))) {
    redirect(pageHref(page));
  }

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
        <>
          <p className="mt-8 text-sm text-content-muted" aria-live="polite">
            Showing {start + 1}–{start + visible.length} of {products.length} {products.length === 1 ? "piece" : "pieces"}
          </p>
          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4">
            {visible.map((product, index) => (
              <ProductCard
                key={product.id}
                product={product}
                priority={index < 4}
              />
            ))}
          </div>
          {pageCount > 1 && (
            <nav aria-label="Collection pages" className="mt-14 flex items-center justify-center gap-6 text-sm">
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className="min-h-11 content-center underline underline-offset-4">
                  Previous
                </Link>
              ) : (
                <span className="min-h-11 content-center text-content-faint">Previous</span>
              )}
              <span aria-current="page" aria-live="polite">Page {page} of {pageCount}</span>
              {page < pageCount ? (
                <Link href={pageHref(page + 1)} className="min-h-11 content-center underline underline-offset-4">
                  Next
                </Link>
              ) : (
                <span className="min-h-11 content-center text-content-faint">Next</span>
              )}
            </nav>
          )}
        </>
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
