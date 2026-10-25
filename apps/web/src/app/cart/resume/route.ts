import { NextResponse, type NextRequest } from "next/server";

import { api } from "@/lib/api";
import { adoptCart } from "@/lib/cart-store";

/**
 * GET /cart/resume?t=<token> — the link in a cart reminder (plan 16 B22).
 *
 * The API checks the signature and that the bag is still open; this puts it
 * on whichever browser tapped the link and goes straight to checkout, where
 * the reminder was pointing. A link that has expired, or a bag already
 * ordered, lands on the bag page rather than an error.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("t") ?? "";
  const to = (path: string) => NextResponse.redirect(new URL(path, request.nextUrl.origin));
  if (!token) return to("/cart");

  try {
    const { cartId } = await api().resumeCart(token);
    await adoptCart(cartId);
    return to("/checkout");
  } catch {
    return to("/cart");
  }
}
