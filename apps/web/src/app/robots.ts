import type { MetadataRoute } from "next";

import { buildRobots } from "@siumora/seo";

export default function robots(): MetadataRoute.Robots {
  // Vercel preview deployments must not compete with production for the same
  // content, so they disallow everything.
  const isPreview = process.env.VERCEL_ENV === "preview";
  return buildRobots({ isPreview });
}
