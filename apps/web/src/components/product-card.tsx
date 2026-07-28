import Image from "next/image";
import Link from "next/link";

import { isInStock, lowestPrice, type Product } from "@siumora/core";
import { MicroLabel, Price } from "@siumora/ui";

export function ProductCard({ product }: { product: Product }) {
  const price = lowestPrice(product);
  const available = isInStock(product);
  const image = product.images[0]!;

  return (
    <Link href={`/products/${product.handle}`} className="group block">
      <div className="relative aspect-4/5 overflow-hidden bg-ground-raised">
        <Image
          src={image.url}
          alt={image.alt}
          width={image.width}
          height={image.height}
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
          className="h-full w-full object-cover transition-transform duration-700 ease-[var(--ease-siumora)] group-hover:scale-[1.03]"
        />

        {!available && (
          <div className="absolute inset-x-0 bottom-0 bg-ground/92 py-2 text-center">
            <MicroLabel>Sold out</MicroLabel>
          </div>
        )}
      </div>

      <div className="mt-4">
        <h3 className="font-heading text-sm uppercase text-content" style={{ letterSpacing: "var(--tracking-caps)" }}>
          {product.title}
        </h3>
        <p className="mt-1 text-sm text-content-muted">{product.subtitle}</p>
        <Price mrp={price.mrp} selling={price.selling} size="sm" className="mt-2" />
      </div>
    </Link>
  );
}
