import type { MetadataRoute } from "next";

import { buildRobots, SITE } from "@siumora/seo";

export default function robots(): MetadataRoute.Robots {
  if (process.env.SITE_PHASE === "coming-soon") {
    return {
      rules: { userAgent: "*", allow: "/", disallow: ["/products/", "/collections/", "/search", "/cart", "/account", "/admin"] },
      sitemap: `${SITE.url}/sitemap.xml`,
    };
  }
  // Vercel preview deployments must not compete with production for the same
  // content, so they disallow everything.
  const isPreview = process.env.VERCEL_ENV === "preview";
  return buildRobots({ isPreview });
}
