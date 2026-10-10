import Image from "next/image";
import Link from "next/link";

import { isInStock, lowestPrice, type Product } from "@siumora/core";
import { MicroLabel, Price } from "@siumora/ui";
import { catalogPresentationImage } from "@/lib/catalog-presentation";
import { StoreIcon } from "./store-icon";

export function ProductCard({
  product,
  priority = false,
}: {
  product: Product;
  /**
   * Set on the cards above the fold.
   *
   * Without it the LCP image queues behind every other card's, and on a
   * throttled 4G connection that is the difference between a 1.2s and a 1.9s
   * largest paint — the budget sits between the two.
   */
  priority?: boolean;
}) {
  const price = lowestPrice(product);
  const available = isInStock(product);
  const image = catalogPresentationImage(product.images[0]!);

  return (
    <Link href={`/products/${product.handle}`} className="group block store-product-card">
      {/* Paired with the PDP gallery by name, so the plate travels between the
          grid and the detail page instead of cutting. Scoped per product —
          a shared name across the grid would animate the wrong tile. */}
      <div
        className="relative aspect-4/5 overflow-hidden bg-ground-raised"
        style={{ viewTransitionName: `product-${product.handle}` }}
      >
        <Image
          src={image.url}
          alt={image.alt}
          width={image.width}
          height={image.height}
          priority={priority}
          sizes="(min-width: 1440px) 310px, (min-width: 1024px) 25vw, 50vw"
          className="h-full w-full object-cover transition-transform duration-700 ease-[var(--ease-siumora)] group-hover:scale-[1.03]"
        />
        <span className="store-product-view">Discover piece <StoreIcon name="arrow" width="17" /></span>

        {!available && (
          <div className="absolute inset-x-0 bottom-0 bg-ground/92 py-2 text-center">
            <MicroLabel>Sold out</MicroLabel>
          </div>
        )}
      </div>

      <div className="store-product-info">
        <h3>
          {product.title}
        </h3>
        <p className="store-product-material">{product.material}</p>
        <Price mrp={price.mrp} selling={price.selling} size="sm" className="mt-2" />
      </div>
    </Link>
  );
}
