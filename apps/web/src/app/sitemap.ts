import type { MetadataRoute } from "next";

import { buildSitemap } from "@siumora/seo";
import { SITE } from "@siumora/seo";

import { listCollections, listProducts } from "@/lib/catalog";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (process.env.SITE_PHASE === "coming-soon") return [{ url: SITE.url }];
  const [products, collections] = await Promise.all([
    listProducts(),
    listCollections(),
  ]);

  return buildSitemap(products, collections);
}
