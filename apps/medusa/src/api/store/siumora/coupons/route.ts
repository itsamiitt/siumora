import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, PromotionActions } from "@medusajs/framework/utils";
import { updateCartPromotionsWorkflow } from "@medusajs/medusa/core-flows";

import { lineDiscountPaise } from "../../../../modules/siumora-order/identity";
import { couponSpellings, parseCouponBody } from "../../../../modules/siumora-order/checkout-rules";

/**
 * POST / DELETE /store/siumora/coupons {cartId, code} — apply or remove a
 * coupon (plan 16 B19). Coupons ARE Medusa's native Promotions: the
 * operator makes them on the stock Promotions page, and Medusa computes the
 * line adjustments that the quote, the Razorpay amount, the order and the
 * GST invoice all read. This route only fronts the native workflow:
 *
 * - one coupon at a time — a new code replaces the previous one (REPLACE),
 *   the way a shopper expects a second code to behave;
 * - its own rate-limit bucket (src/lib/rate-limit.ts, 10/min), because a
 *   coupon field is a guessing surface; the native /store/carts/:id/
 *   promotions door is closed in src/api/middlewares.ts for the same reason;
 * - plain answers: unknown code → 400 "not a valid code"; a real code whose
 *   conditions this bag does not meet → 409, and it is taken off again
 *   rather than left on the cart doing nothing.
 *
 * Answers {coupons, discount} — the codes now on the cart and the paise
 * they take off — so the summary can update before the next quote lands.
 */

interface CartRead {
  id: string;
  completed_at?: unknown;
  promotions?: Array<{ code?: string | null } | null> | null;
  items?: Array<{ adjustments?: Array<{ amount?: unknown; code?: string | null } | null> | null } | null> | null;
}

async function readCart(req: MedusaRequest, cartId: string): Promise<CartRead | undefined> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "completed_at", "promotions.code", "items.adjustments.amount", "items.adjustments.code"],
    filters: { id: cartId },
  });
  return data[0] as CartRead | undefined;
}

function couponsOf(cart: CartRead): string[] {
  return (cart.promotions ?? [])
    .map((promotion) => promotion?.code)
    .filter((code): code is string => typeof code === "string" && code.length > 0);
}

function discountOf(cart: CartRead, code?: string): number {
  return (cart.items ?? []).reduce((sum, item) => {
    const adjustments = (item?.adjustments ?? []).filter((adjustment) => !code || adjustment?.code === code);
    return sum + lineDiscountPaise({ quantity: 0, unit_price: 0, adjustments });
  }, 0);
}

async function openCart(req: MedusaRequest, res: MedusaResponse) {
  // DELETE may arrive with its fields in the query string — some clients
  // drop a DELETE body.
  const parsed = parseCouponBody({ ...(req.query as Record<string, unknown>), ...((req.body as object) ?? {}) });
  if (!parsed.ok) {
    res.status(400).json({ error: "invalid_request", message: parsed.message });
    return undefined;
  }
  const cart = await readCart(req, parsed.cartId);
  if (!cart || cart.completed_at) {
    res.status(404).json({ error: "cart_not_found", message: "This bag has already been checked out or has expired." });
    return undefined;
  }
  return { cart, code: parsed.code };
}

function isInvalidCode(error: unknown): boolean {
  return error instanceof Error && /promotion code .* is invalid/i.test(error.message);
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const opened = await openCart(req, res);
  if (!opened) return;
  const { cart, code } = opened;

  let applied: string | undefined;
  for (const spelling of couponSpellings(code)) {
    try {
      await updateCartPromotionsWorkflow(req.scope).run({
        input: { cart_id: cart.id, promo_codes: [spelling], action: PromotionActions.REPLACE },
      });
      applied = spelling;
      break;
    } catch (error) {
      if (!isInvalidCode(error)) throw error;
    }
  }
  if (!applied) {
    res.status(400).json({ error: "invalid_coupon", message: `${code} is not a valid code.` });
    return;
  }

  const after = (await readCart(req, cart.id))!;
  if (!couponsOf(after).includes(applied) || discountOf(after, applied) === 0) {
    // A real code this bag does not qualify for: take it off again so the
    // cart does not carry a coupon that does nothing.
    await updateCartPromotionsWorkflow(req.scope).run({
      input: { cart_id: cart.id, promo_codes: [applied], action: PromotionActions.REMOVE },
    });
    res.status(409).json({
      error: "coupon_not_applicable",
      message: `${applied} does not apply to what is in your bag.`,
    });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({ coupons: couponsOf(after), discount: discountOf(after) });
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const opened = await openCart(req, res);
  if (!opened) return;
  const { cart, code } = opened;

  const present = couponsOf(cart).find((applied) => couponSpellings(code).includes(applied) || applied === code);
  if (present) {
    await updateCartPromotionsWorkflow(req.scope).run({
      input: { cart_id: cart.id, promo_codes: [present], action: PromotionActions.REMOVE },
    });
  }
  const after = (await readCart(req, cart.id))!;
  res.setHeader("Cache-Control", "no-store");
  res.json({ coupons: couponsOf(after), discount: discountOf(after) });
}
