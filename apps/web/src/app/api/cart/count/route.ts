import { NextResponse } from "next/server";

import { getCartLines } from "@/lib/cart-store";

/**
 * Cart item count.
 *
 * Exists so the header badge can be dynamic without dragging the whole layout
 * — and therefore every catalogue page — out of static rendering. Reading the
 * cart cookie during layout render would force `ƒ` on the home page, PLPs and
 * PDPs, which is exactly the tier the performance budget depends on.
 */
export async function GET() {
  const lines = await getCartLines();
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);

  return NextResponse.json(
    { count },
    { headers: { "Cache-Control": "no-store" } },
  );
}
