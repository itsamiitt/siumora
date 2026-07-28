import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { notFound } from "next/navigation";

import { lowestPrice } from "@siumora/core";
import { breadcrumbJsonLd, productJsonLd, productMetadata } from "@siumora/seo";
import { CollectionTitle, Display, Price, TrustRow } from "@siumora/ui";

import { AddToBag } from "@/components/add-to-bag";
import { ProductGallery } from "@/components/product-gallery";
import { JsonLdScript } from "@/components/json-ld";
import { PincodeChecker } from "@/components/pincode-checker";
import { ReviewsBlock } from "@/components/reviews-block";
import { WishlistButton } from "@/components/wishlist-button";
import { TrackViewItem } from "@/components/track-view-item";
import { itemFromProduct } from "@/lib/analytics-items";
import { getProduct, listProducts } from "@/lib/catalog";
import { COUNTRY_OF_ORIGIN, RETURN_WINDOW_DAYS } from "@/lib/legal";
import { listReviews } from "@/lib/reviews";

interface PageProps {
  params: Promise<{ handle: string }>;
}

/**
 * Every line is something the site actually does, drawn from the same constants
 * the rest of the code enforces. A trust row that promises a window the returns
 * engine would refuse is worse than no trust row.
 */
const PDP_TRUST = [
  { label: `${RETURN_WINDOW_DAYS}-day returns`, detail: "free pickup on faults" },
  { label: "GST invoice", detail: "with every order" },
  { label: "Gift-wrapped", detail: "as standard" },
];

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

  return productMetadata(product);
}

export default async function ProductPage({ params }: PageProps) {
  // The whole page is cacheable: nothing on it is per-visitor. Saying so
  // explicitly is what lets the product JSON-LD read the clock for
  // priceValidUntil — an uncached read would pin it to the build.
  "use cache";
  cacheLife("days");

  const { handle } = await params;
  const product = await getProduct(handle);
  if (!product) notFound();

  const price = lowestPrice(product);
  const reviews = await listReviews(product.handle);

  const collectionHandle = product.collections[0];

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <JsonLdScript
        data={[
          productJsonLd(product, { reviews }),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            ...(collectionHandle
              ? [
                  {
                    name: collectionHandle.replace(/-/g, " "),
                    path: `/collections/${collectionHandle}`,
                  },
                ]
              : []),
            { name: product.title, path: `/products/${product.handle}` },
          ]),
        ]}
      />

      <TrackViewItem
        item={itemFromProduct(product)}
        value={price.selling / 100}
      />

      <div className="grid gap-12 lg:grid-cols-2">
        <ProductGallery
          images={product.images}
          title={product.title}
          handle={product.handle}
        />

        <div className="lg:py-6">
          <CollectionTitle className="text-xs">
            {product.collections[0]?.replace(/-/g, " ") ?? "Siumora"}
          </CollectionTitle>

          <Display as="h1" size="sm" className="mt-4">
            {product.title}
          </Display>

          <p className="mt-3 text-content-muted">{product.subtitle}</p>

          <Price
            mrp={price.mrp}
            selling={price.selling}
            size="lg"
            showTaxNote
            emiMonths={3}
            className="mt-7"
          />

          <div className="mt-9">
            <AddToBag variants={product.variants} productTitle={product.title} />
          </div>

          {/* Directly under the button, where the decision is made. */}
          <TrustRow className="mt-5" items={PDP_TRUST} />

          <div className="mt-5">
            <WishlistButton
              handle={product.handle}
              item={itemFromProduct(product)}
              value={price.selling / 100}
            />
          </div>

          <div className="mt-8 border-t border-[var(--color-rule)] pt-6">
            <PincodeChecker />
          </div>

          <dl className="mt-10 space-y-4 border-t border-[var(--color-rule)] pt-8 text-sm">
            <div>
              <dt className="text-content-muted">Material</dt>
              <dd className="mt-1">{product.material}</dd>
            </div>
            <div>
              {/* Required on every listing under the Legal Metrology rules. */}
              <dt className="text-content-muted">Country of origin</dt>
              <dd className="mt-1">{COUNTRY_OF_ORIGIN}</dd>
            </div>
            <div>
              <dt className="text-content-muted">About</dt>
              <dd className="mt-1 leading-relaxed">{product.description}</dd>
            </div>
          </dl>
        </div>
      </div>

      <ReviewsBlock reviews={reviews} />
    </div>
  );
}
