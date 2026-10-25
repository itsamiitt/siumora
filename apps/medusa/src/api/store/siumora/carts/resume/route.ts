import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { readToken, tokenSecret } from "../../../../../lib/signed-token";

/**
 * POST /store/siumora/carts/resume {token} — the link in a cart reminder
 * (plan 16 B22). The storefront's /cart/resume page posts the token here
 * and, given a cart id back, puts that bag on the browser that tapped it.
 *
 * The token is signed and expires (seven days), so a reminder link cannot
 * be edited into someone else's cart; a bag already checked out answers
 * 410 so the page can say so instead of showing an empty bag.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const payload = readToken((req.body as { token?: unknown } | undefined)?.token, "cart_resume", tokenSecret());
  const cartId = typeof payload?.cart === "string" ? payload.cart : undefined;
  if (!cartId) {
    res.status(400).json({ error: "invalid_link", message: "This link has expired." });
    return;
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({ entity: "cart", fields: ["id", "completed_at"], filters: { id: cartId } });
  const cart = data[0] as { id: string; completed_at?: unknown } | undefined;
  if (!cart) {
    res.status(404).json({ error: "cart_not_found", message: "This bag is no longer saved." });
    return;
  }
  if (cart.completed_at) {
    res.status(410).json({ error: "already_ordered", message: "This bag has already been ordered." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ cartId: cart.id });
}
