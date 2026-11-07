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
  let handles: string[];
  try {
    handles = await listWishlist();
  } catch {
    // Backend unreachable: a clean 503 the heart button already treats as
    // "unknown", rather than an unhandled 500 with a stack in the logs.
    return NextResponse.json(
      { error: "unavailable", handles: [] },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { handles },
    { headers: { "Cache-Control": "no-store" } },
  );
}
