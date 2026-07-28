import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { collectionJsonLd, collectionMetadata } from "@siumora/seo";
import { Display } from "@siumora/ui";

import { JsonLdScript } from "@/components/json-ld";
import { ProductCard } from "@/components/product-card";
import {
  getCollection,
  listCollections,
  listProductsInCollection,
} from "@/lib/catalog";

interface PageProps {
  params: Promise<{ handle: string }>;
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

export default async function CollectionPage({ params }: PageProps) {
  const { handle } = await params;
  const collection = await getCollection(handle);
  if (!collection) notFound();

  const products = await listProductsInCollection(handle);

  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <JsonLdScript data={collectionJsonLd(collection, products)} />

      <header className="border-b border-[var(--color-rule)] pb-10 text-center">
        <Display as="h1" size="md">
          {collection.title}
        </Display>
        <p className="mx-auto mt-4 max-w-md text-content-muted">
          {collection.description}
        </p>
      </header>

      {products.length > 0 ? (
        <div className="mt-14 grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4">
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
          Nothing here yet. Something is on its way.
        </p>
      )}
    </div>
  );
}
