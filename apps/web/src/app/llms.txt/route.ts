import { buildLlmsTxt } from "@siumora/seo";

import { listCollections, listProducts } from "@/lib/catalog";

/**
 * llms.txt — machine-readable store brief for AI engines.
 *
 * Served as a route rather than a static file so it regenerates with the
 * catalogue instead of drifting out of date the first time a price changes.
 */
export async function GET() {
  const [products, collections] = await Promise.all([
    listProducts(),
    listCollections(),
  ]);

  return new Response(buildLlmsTxt(products, collections), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
