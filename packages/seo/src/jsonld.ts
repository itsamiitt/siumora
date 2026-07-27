import { isInStock, lowestPrice, type Collection, type Product } from "@siumora/core";

import { SITE } from "./site.ts";

/**
 * JSON-LD builders.
 *
 * Dual-purpose: rich results in Google, and machine-readable facts for AI
 * engines deciding whether to cite the store. Both want the same thing —
 * complete, honest, consistently-named entities.
 *
 * Prices are emitted as decimal rupee strings. Schema.org expects a decimal
 * number; paise would advertise every piece at 100x its price.
 */

export interface JsonLd {
  "@context": "https://schema.org";
  [key: string]: unknown;
}

function rupees(paise: number): string {
  return (paise / 100).toFixed(2);
}

function absolute(path: string): string {
  return new URL(path, SITE.url).toString();
}

/**
 * `priceValidUntil` — Google warns on Offers without it.
 *
 * A year out is the convention: long enough not to churn, short enough that a
 * stale feed stops claiming a price indefinitely.
 */
function priceValidUntil(from: Date): string {
  const until = new Date(from);
  until.setFullYear(until.getFullYear() + 1);
  return until.toISOString().slice(0, 10);
}

export function productJsonLd(
  product: Product,
  options: { now?: Date } = {},
): JsonLd {
  const price = lowestPrice(product);
  const available = isInStock(product);

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description,
    sku: product.variants[0]?.sku,
    brand: { "@type": "Brand", name: SITE.name },
    material: product.material,
    image: product.images.map((image) => absolute(image.url)),
    url: absolute(`/products/${product.handle}`),
    offers: {
      "@type": "Offer",
      priceCurrency: "INR",
      price: rupees(price.selling),
      priceValidUntil: priceValidUntil(options.now ?? new Date()),
      availability: available
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      url: absolute(`/products/${product.handle}`),
      seller: { "@type": "Organization", name: SITE.name },
    },
  };
}

export function collectionJsonLd(
  collection: Collection,
  products: readonly Product[],
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: collection.title,
    description: collection.description,
    url: absolute(`/collections/${collection.handle}`),
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: products.length,
      itemListElement: products.map((product, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: absolute(`/products/${product.handle}`),
        name: product.title,
      })),
    },
  };
}

export interface Crumb {
  name: string;
  path: string;
}

export function breadcrumbJsonLd(crumbs: readonly Crumb[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absolute(crumb.path),
    })),
  };
}

export function organizationJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE.name,
    url: SITE.url,
    logo: absolute("/brand/siumora-mark.svg"),
    description: SITE.description,
    slogan: SITE.tagline,
    areaServed: { "@type": "Country", name: "India" },
  };
}

export function websiteJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.name,
    url: SITE.url,
    inLanguage: "en-IN",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: absolute("/search?q={search_term_string}"),
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export interface FaqEntry {
  question: string;
  answer: string;
}

export function faqJsonLd(entries: readonly FaqEntry[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}
