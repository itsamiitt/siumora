import { NextResponse } from "next/server";

import { listWishlist } from "@/lib/wishlist-store";

/**
 * The visitor's saved handles.
 *
 * Exists so a product page can show its saved state without reading the
 * wishlist cookie during render — that would make the route dynamic and pull
 * every PDP out of the static tier the LCP budget depends on.
 */
export async function GET() {
  const handles = await listWishlist();
  return NextResponse.json(
    { handles },
    { headers: { "Cache-Control": "no-store" } },
  );
}
