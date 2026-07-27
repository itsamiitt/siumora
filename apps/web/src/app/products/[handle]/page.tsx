import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { lowestPrice } from "@siumora/core";
import { formatPaise } from "@siumora/in-locale";
import { CollectionTitle, Display, Price } from "@siumora/ui";

import { AddToBag } from "@/components/add-to-bag";
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

          <div className="mt-9">
            <AddToBag variants={product.variants} />
          </div>

          <div className="mt-8 border-t border-[var(--color-rule)] pt-6">
            <PincodeChecker />
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
