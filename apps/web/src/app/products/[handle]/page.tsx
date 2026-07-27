import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { isInStock, lowestPrice } from "@siumora/core";
import { formatPaise } from "@siumora/in-locale";
import { CollectionTitle, Display, MicroLabel, Price } from "@siumora/ui";

import { PincodeChecker } from "@/components/pincode-checker";
import { getProduct, listProducts } from "@/lib/catalog";

interface PageProps {
  params: Promise<{ handle: string }>;
}

export async function generateStaticParams() {
  const products = await listProducts();
  return products.map((product) => ({ handle: product.handle }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { handle } = await params;
  const product = await getProduct(handle);
  if (!product) return {};

  const price = lowestPrice(product);
  return {
    title: product.title,
    description: product.subtitle,
    openGraph: {
      title: `${product.title} · ${formatPaise(price.selling)}`,
      description: product.subtitle,
      images: product.images.map((image) => ({ url: image.url })),
    },
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { handle } = await params;
  const product = await getProduct(handle);
  if (!product) notFound();

  const price = lowestPrice(product);
  const available = isInStock(product);
  const image = product.images[0]!;

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <div className="grid gap-12 lg:grid-cols-2">
        {/* Held at the catalogue's 4:5 ratio so the plate never stretches to
            match whatever the detail column happens to be. */}
        <div className="aspect-4/5 self-start bg-blush">
          <Image
            src={image.url}
            alt={image.alt}
            width={image.width}
            height={image.height}
            priority
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="h-full w-full object-cover"
          />
        </div>

        <div className="lg:py-6">
          <CollectionTitle className="text-xs">
            {product.collections[0]?.replace(/-/g, " ") ?? "Siumora"}
          </CollectionTitle>

          <Display as="h1" size="sm" className="mt-4">
            {product.title}
          </Display>

          <p className="mt-3 text-ink-muted">{product.subtitle}</p>

          <Price
            mrp={price.mrp}
            selling={price.selling}
            size="lg"
            showTaxNote
            emiMonths={3}
            className="mt-7"
          />

          {/* Variant picker. Sold-out variants stay visible but unselectable —
              hiding them makes the range look thinner than it is. */}
          <fieldset className="mt-9">
            <legend className="sr-only">Choose an option</legend>
            <MicroLabel>Options</MicroLabel>
            <div className="mt-3 flex flex-wrap gap-2.5">
              {product.variants.map((variant) => {
                const soldOut = variant.inventory === 0;
                return (
                  <button
                    key={variant.id}
                    type="button"
                    disabled={soldOut}
                    aria-disabled={soldOut}
                    className={
                      soldOut
                        ? "cursor-not-allowed border border-ink/12 px-5 py-2.5 text-sm text-ink-faint line-through"
                        : "border border-ink/25 px-5 py-2.5 text-sm transition-colors hover:border-mulberry hover:text-mulberry"
                    }
                  >
                    {variant.title}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-8 border-t border-[var(--color-rule)] pt-6">
            <PincodeChecker />
          </div>

          <div className="mt-8">
            {/* Cart mutation lands in Phase 2 with the Server Action; the
                control is rendered disabled rather than faking a working flow. */}
            <button
              type="button"
              disabled
              className="h-14 w-full cursor-not-allowed bg-mulberry/40 font-body text-[13px] font-medium uppercase text-ivory"
              style={{ letterSpacing: "var(--tracking-caps)" }}
            >
              {available ? "Add to bag" : "Sold out"}
            </button>
            <p className="mt-2 text-center text-xs text-ink-faint">
              Cart opens in Phase 2
            </p>
          </div>

          <dl className="mt-10 space-y-4 border-t border-[var(--color-rule)] pt-8 text-sm">
            <div>
              <dt className="text-ink-muted">Material</dt>
              <dd className="mt-1">{product.material}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">About</dt>
              <dd className="mt-1 leading-relaxed">{product.description}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
