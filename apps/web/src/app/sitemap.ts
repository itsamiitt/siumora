import type { MetadataRoute } from "next";

import { buildSitemap } from "@siumora/seo";
import { SITE } from "@siumora/seo";

import { listCollections, listProducts } from "@/lib/catalog";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (process.env.SITE_PHASE === "coming-soon") return [{ url: SITE.url }];
  try {
    const [products, collections] = await Promise.all([
      listProducts(),
      listCollections(),
    ]);
    return [...buildSitemap(products, collections), { url: `${SITE.url}/shop` }];
  } catch (error) {
    // Backend down: the static pages still deserve a sitemap; a 500 here
    // would have crawlers back off the whole site.
    console.error("[sitemap] catalogue unavailable, serving static pages only:", error);
    return [...buildSitemap([], []), { url: `${SITE.url}/shop` }];
  }
}
