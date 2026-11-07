import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { normalisePhone } from "@siumora/core";

import { checkoutSettings } from "../../../../../../lib/checkout-context";
import { verifiedPhone } from "../../../../../../lib/customer-signin";
import { currentSession } from "../../../../../../lib/session-auth";
import { recordReminderConsent, withdrawReminderConsent, type SqlClient } from "../../../../../../modules/outbox/data";

/**
 * POST /store/siumora/carts/:cartId/reminders {phone, consent} — the
 * cart-reminder opt-in from checkout step 1 (plan 16 B22). Recorded the
 * moment the shopper leaves the step, because the reminder is for the
 * shopper who never reaches Pay.
 *
 * Consent is explicit and for this one purpose (DPDP): the box starts
 * unticked, ticking records the number and the time, unticking withdraws.
 * Off in Settings, the route records nothing and says so — the storefront
 * does not offer the box then anyway.
 *
 * Whose number (security review, item 7): the route takes a cart id and a
 * phone from anyone, and the reminder is a paid WhatsApp. So the number must
 * be one the cart vouches for — the signed-in shopper's verified phone, or
 * the delivery phone already on the cart. At step 1 a guest's cart has no
 * address yet; that opt-in is recorded, and the sweep
 * (src/jobs/cart-reminders.ts) sends only once the cart's own delivery
 * phone matches, at most one reminder per number per day.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const body = (req.body ?? {}) as { phone?: unknown; consent?: unknown };
  if (typeof body.consent !== "boolean") {
    res.status(400).json({ error: "invalid_request", message: "consent: expected true or false" });
    return;
  }

  const settings = await checkoutSettings(req);
  if (!settings.cartRecoveryEnabled) {
    res.json({ reminders: false });
    return;
  }

  const cartId = req.params.cartId!;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "completed_at", "shipping_address.phone"],
    filters: { id: cartId },
  });
  const cart = data[0] as
    | { id: string; completed_at?: unknown; shipping_address?: { phone?: string | null } | null }
    | undefined;
  if (!cart || cart.completed_at) {
    res.status(404).json({ error: "cart_not_found" });
    return;
  }

  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlClient;
  if (!body.consent) {
    await withdrawReminderConsent(pg, cartId);
    res.json({ reminders: false });
    return;
  }

  const phone = typeof body.phone === "string" ? (normalisePhone(body.phone) as string | undefined) : undefined;
  if (!phone) {
    res.status(400).json({ error: "invalid_request", message: "phone: expected a 10-digit mobile number" });
    return;
  }
  const session = currentSession(req);
  const accountPhone = session ? await verifiedPhone(req, session.customerId) : undefined;
  const cartPhone = normalisePhone(cart.shipping_address?.phone ?? "") as string | undefined;
  // A cart that already names a delivery phone vouches for that one only
  // (or the signed-in shopper's own); before then, the sweep checks later.
  if (phone !== accountPhone && cartPhone && phone !== cartPhone) {
    res.status(403).json({
      error: "phone_not_on_cart",
      message: "Reminders go to the number you're checking out with.",
    });
    return;
  }
  await recordReminderConsent(pg, { cartId, phone, now: new Date() });
  res.json({ reminders: true });
}
