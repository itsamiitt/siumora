import Link from "next/link";

import { CollectionTitle, Display, MicroLabel } from "@siumora/ui";

import { ProductCard } from "@/components/product-card";
import { listCollections, listProducts } from "@/lib/catalog";

export default async function HomePage() {
  const [products, collections] = await Promise.all([
    listProducts(),
    listCollections(),
  ]);

  return (
    <>
      {/* Hero. Ivory ground, ink type, one mulberry accent on the label —
          holding the 62/20/11/5/2 proportion. */}
      <section className="border-b border-[var(--color-rule)]">
        <div className="mx-auto max-w-6xl px-5 py-24 text-center sm:py-32">
          <MicroLabel tone="mulberry">Gift &amp; reward</MicroLabel>
          <Display as="h1" size="lg" className="mx-auto mt-6 max-w-2xl">
            Something given, something kept.
          </Display>
          <p className="mx-auto mt-6 max-w-md text-content-muted">
            Demi-fine jewellery in 925 sterling silver and 18k gold PVD. Made to
            be worn, not stored.
          </p>
          <Link
            href="/collections/everyday"
            className="mt-9 inline-block border-b border-content pb-1 transition-colors hover:border-accent-ink hover:text-accent-ink"
          >
            <MicroLabel>Shop everyday</MicroLabel>
          </Link>
        </div>
      </section>

      {/* Jaali band. The pattern never carries the logo — it is what the logo
          is made of — so this band holds a line of copy instead. */}
      <section className="siumora-jaali border-b border-[var(--color-rule)] bg-ground-raised/40">
        <div className="mx-auto max-w-6xl px-5 py-14 text-center">
          <p className="font-display text-2xl font-light text-content">
            Every piece leaves here wrapped as a gift.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="flex items-baseline justify-between gap-6">
          <CollectionTitle className="text-sm">New in</CollectionTitle>
          <Link
            href="/collections/everyday"
            className="transition-colors hover:text-accent-ink"
          >
            <MicroLabel>View all</MicroLabel>
          </Link>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4">
          {products.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              priority={index < 4}
            />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-8">
        <CollectionTitle className="text-sm">Collections</CollectionTitle>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {collections.map((collection) => (
            <Link
              key={collection.id}
              href={`/collections/${collection.handle}`}
              className="border border-[var(--color-rule)] p-8 transition-colors hover:border-accent-ink/40"
            >
              <CollectionTitle className="text-xs">
                {collection.title}
              </CollectionTitle>
              <p className="mt-3 text-sm text-content-muted">
                {collection.description}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
