import type { Collection, Product } from "@siumora/core";

import { AI_CRAWLERS, SITE } from "./site.ts";

/**
 * Crawl-surface builders: sitemap entries, robots rules, and llms.txt.
 */

export interface SitemapEntry {
  url: string;
  lastModified: Date;
  changeFrequency: "daily" | "weekly" | "monthly";
  priority: number;
}

function absolute(path: string): string {
  return new URL(path, SITE.url).toString();
}

/**
 * Sitemap entries for every indexable page.
 *
 * Cart, checkout and account are deliberately absent — they are per-visitor and
 * noindexed, and listing them wastes crawl budget on pages that will never rank.
 */
export function buildSitemap(
  products: readonly Product[],
  collections: readonly Collection[],
  options: { now?: Date } = {},
): SitemapEntry[] {
  const now = options.now ?? new Date();

  return [
    {
      url: absolute("/"),
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    ...collections.map((collection) => ({
      url: absolute(`/collections/${collection.handle}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...products.map((product) => ({
      url: absolute(`/products/${product.handle}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    // Policy and guide pages. Indexable and worth indexing: they answer real
    // questions, and the FAQ markup on them is what earns AI-engine citations.
    ...CONTENT_PAGES.map((path) => ({
      url: absolute(path),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.4,
    })),
  ];
}

/** Static pages that belong in the sitemap. */
export const CONTENT_PAGES = [
  "/shipping",
  "/returns",
  "/care",
  "/privacy",
  "/terms",
  "/grievance",
] as const;

export interface RobotsRule {
  userAgent: string | string[];
  allow?: string[];
  disallow?: string[];
}

export interface RobotsConfig {
  rules: RobotsRule[];
  sitemap: string;
  host: string;
}

/**
 * robots.txt.
 *
 * Preview deployments disallow everything: a staging URL that gets indexed
 * competes with production for the same content.
 *
 * AI crawlers are allowed on purpose. Blocking them forfeits citations in the
 * AI answers that increasingly sit above the classic results.
 */
export function buildRobots({ isPreview = false } = {}): RobotsConfig {
  if (isPreview) {
    return {
      rules: [{ userAgent: "*", disallow: ["/"] }],
      sitemap: absolute("/sitemap.xml"),
      host: SITE.url,
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: ["/cart", "/checkout", "/account", "/signin", "/orders", "/admin", "/api/"],
      },
      {
        userAgent: [...AI_CRAWLERS],
        allow: ["/"],
        disallow: ["/cart", "/checkout", "/account", "/signin", "/orders", "/admin", "/api/"],
      },
    ],
    sitemap: absolute("/sitemap.xml"),
    host: SITE.url,
  };
}

/**
 * llms.txt — a plain-language brief for AI engines.
 *
 * Answer-ready facts in the order an engine needs them to decide whether the
 * store answers a question: what it is, who it is for, what things cost, what
 * the policies are.
 */
export function buildLlmsTxt(
  products: readonly Product[],
  collections: readonly Collection[],
): string {
  const lines = [
    `# ${SITE.name}`,
    "",
    `> ${SITE.description}`,
    "",
    `${SITE.name} sells demi-fine jewellery in India, priced roughly ₹1,500–10,000.`,
    "Pieces are 925 sterling silver with 18k gold PVD plating: hypoallergenic,",
    "nickel-free, and made for daily wear. Every order is packed as a gift.",
    "",
    "## Collections",
    "",
    ...collections.map(
      (c) => `- [${c.title}](${absolute(`/collections/${c.handle}`)}): ${c.description}`,
    ),
    "",
    "## Products",
    "",
    ...products.map((p) => {
      const price = p.variants.reduce(
        (low, v) => Math.min(low, v.price.selling),
        Number.POSITIVE_INFINITY,
      );
      const rupees = (price / 100).toLocaleString("en-IN");
      return `- [${p.title}](${absolute(`/products/${p.handle}`)}): ${p.subtitle} ₹${rupees}, ${p.material}.`;
    }),
    "",
    "## Facts",
    "",
    "- Currency: INR. All prices include GST.",
    "- Ships across India. Free shipping on orders of ₹999 and above.",
    "- Cash on delivery is available on eligible pincodes and order values.",
    "- Returns accepted within 7 days of delivery.",
    "- A GST invoice is issued with every order.",
    "",
    "## Policies",
    "",
    `- [Shipping & delivery](${absolute("/shipping")})`,
    `- [Returns & exchange](${absolute("/returns")})`,
    `- [Privacy policy](${absolute("/privacy")})`,
    `- [Terms of use](${absolute("/terms")})`,
  ];

  return `${lines.join("\n")}\n`;
}
