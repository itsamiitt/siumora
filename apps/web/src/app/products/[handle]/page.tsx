import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { notFound } from "next/navigation";

import { lowestPrice, type Product, type Review } from "@siumora/core";
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
import Link from "next/link";
import { categoryHref, productCategoryTrail } from "@/components/site-navigation";
import { getCollection, getProduct, listAllCategories, listProducts } from "@/lib/catalog";
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
  // No backend configured (typegen, lint-only CI) or the catalog fetch failed:
  // prerender nothing and let each handle render on demand instead of failing
  // the whole build.
  try {
    const products = await listProducts();
    return products.map((product) => ({ handle: product.handle }));
  } catch (error) {
    console.warn("[generateStaticParams] products: catalog unavailable, prerendering none", error);
    return [];
  }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { handle } = await params;
  const product = await getProduct(handle);
  if (!product) return {};

  return productMetadata(product);
}

/** Only the clock-dependent JSON-LD is cached, keyed by the current product. */
async function ProductStructuredData({ product, reviews, trail }: { product: Product; reviews: Review[]; trail: Crumb[] }) {
  "use cache";
  cacheLife("days");
  return (
      <JsonLdScript
        data={[
          productJsonLd(product, { reviews }),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            ...trail,
            { name: product.title, path: `/products/${product.handle}` },
          ]),
        ]}
      />
  );
}

interface Crumb { name: string; path: string }

/**
 * Home › category chain (as the admin nests it) › product; a product with no
 * visible category falls back to its collection, by the collection's real
 * title rather than its handle.
 */
async function productTrail(product: Product): Promise<{ trail: Crumb[]; collectionTitle: string | undefined }> {
  const [categories, collection] = await Promise.all([
    listAllCategories(),
    product.collections[0] ? getCollection(product.collections[0]) : Promise.resolve(undefined),
  ]);
  const byCategory = productCategoryTrail(categories, product).map((category) => ({ name: category.name, path: categoryHref(category) }));
  const trail = byCategory.length
    ? byCategory
    : collection ? [{ name: collection.title, path: `/collections/${collection.handle}` }] : [];
  return { trail, collectionTitle: collection?.title };
}

export default async function ProductPage({ params }: PageProps) {
  const { handle } = await params;
  const product = await getProduct(handle);
  if (!product) notFound();
  const price = lowestPrice(product);
  const [reviews, { trail, collectionTitle }] = await Promise.all([listReviews(product.handle), productTrail(product)]);

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <ProductStructuredData product={product} reviews={reviews} trail={trail} />

      <nav aria-label="Breadcrumb" className="mb-6 text-xs text-content-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li><Link href="/" className="hover:text-accent-ink">Home</Link></li>
          {trail.map((crumb) => (
            <li key={crumb.path} className="flex items-center gap-1.5">
              <span aria-hidden="true">/</span>
              <Link href={crumb.path} className="hover:text-accent-ink">{crumb.name}</Link>
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true">/</span>
            <span aria-current="page" className="text-content">{product.title}</span>
          </li>
        </ol>
      </nav>

      <TrackViewItem
        item={itemFromProduct(product)}
        value={price.selling / 100}
      />

      <div className="grid gap-12 lg:grid-cols-2">
        <ProductGallery
          key={`${product.id}:${product.images.map((image) => image.url).join("|")}`}
          images={product.images}
          title={product.title}
          handle={product.handle}
        />

        <div className="lg:py-6">
          <CollectionTitle className="text-xs">
            {collectionTitle ?? "Siumora"}
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
