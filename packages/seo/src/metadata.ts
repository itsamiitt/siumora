import { lowestPrice, type Collection, type Product } from "@siumora/core";
import { alternates } from "@siumora/in-locale";

import { SITE } from "./site.ts";

/**
 * Metadata builders.
 *
 * Shaped to Next's Metadata object but typed structurally, so this package does
 * not depend on Next and stays unit-testable.
 */

export interface PageMetadata {
  title: string;
  description: string;
  alternates: { canonical: string; languages: Record<string, string> };
  openGraph: {
    title: string;
    description: string;
    url: string;
    type: "website" | "article";
  };
  robots?: { index: boolean; follow: boolean };
}

/**
 * The path part of an absolute URL.
 *
 * hreflang is built per path, and the builders already hold the canonical, so
 * this avoids threading the path through every signature a second time.
 */
function pathOf(absolute: string): string {
  return absolute.slice(SITE.url.length) || "/";
}

/** Titles are truncated on the SERP past roughly this width. */
const TITLE_LIMIT = 60;
const DESCRIPTION_LIMIT = 160;

/** Trim to a limit on a word boundary, with an ellipsis when cut. */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function url(path: string): string {
  return new URL(path, SITE.url).toString();
}

export function productMetadata(product: Product): PageMetadata {
  const price = lowestPrice(product);
  const rupees = (price.selling / 100).toLocaleString("en-IN");
  const canonical = url(`/products/${product.handle}`);

  // The price belongs in the description, not the title: it changes on
  // promotion and would churn the indexed title every time.
  return {
    title: truncate(`${product.title} · ${SITE.name}`, TITLE_LIMIT),
    description: truncate(
      `${product.subtitle} ${product.material}. ₹${rupees}, inclusive of all taxes.`,
      DESCRIPTION_LIMIT,
    ),
    alternates: { canonical, languages: alternates(pathOf(canonical), SITE.url) },
    openGraph: {
      title: product.title,
      description: product.subtitle,
      url: canonical,
      type: "website",
      // Deliberately no `images`. Setting it here overrides the generated
      // opengraph-image card, and the catalogue asset it pointed at is an SVG —
      // which several platforms refuse to render in a preview at all.
    },
  };
}

export function collectionMetadata(collection: Collection): PageMetadata {
  const canonical = url(`/collections/${collection.handle}`);

  return {
    title: truncate(`${collection.title} · ${SITE.name}`, TITLE_LIMIT),
    description: truncate(
      `${collection.description} ${SITE.description}`,
      DESCRIPTION_LIMIT,
    ),
    alternates: { canonical, languages: alternates(pathOf(canonical), SITE.url) },
    openGraph: {
      title: collection.title,
      description: collection.description,
      url: canonical,
      type: "website",
    },
  };
}

/**
 * Metadata for a page that must never be indexed.
 *
 * Cart, checkout and account carry personal state; an indexed checkout URL is
 * both useless in results and a privacy problem.
 */
export function noindexMetadata(title: string): PageMetadata {
  const canonical = url("/");
  return {
    title: truncate(`${title} · ${SITE.name}`, TITLE_LIMIT),
    description: SITE.description,
    alternates: { canonical, languages: alternates(pathOf(canonical), SITE.url) },
    openGraph: {
      title,
      description: SITE.description,
      url: canonical,
      type: "website",
    },
    robots: { index: false, follow: false },
  };
}
