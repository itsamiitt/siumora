import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { checkoutSettings, customerSignals } from "../../../../../lib/checkout-context";
import { toInvoiceLines, type InvoiceLineWire } from "../../../../../modules/gst/invoice";
import { findPincode, type SqlClient } from "../../../../../modules/serviceability/lookup";
import { computeQuote, parseQuoteBody } from "../../../../../modules/serviceability/serviceability";
import { cartVersion, quoteTotals } from "../../../../../modules/siumora-order/checkout-rules";
import { lineDiscountPaise, linePaise, wireNumber } from "../../../../../modules/siumora-order/identity";

/**
 * POST /store/siumora/checkout/quote — delivery promise, COD eligibility
 * and any fee, before anything is created.
 *
 * The recorded contract (apps/api/src/routes/checkout.ts /checkout/quote +
 * apps/api/src/sdk-contract.test.ts quoteCheckout) pins the envelope:
 * {serviceable, estimatedDays, addressQuality{score,issues,needsReview},
 * rto{risk,score}, cod, phoneVerified}. Every decision that costs money is
 * made here from what the customer actually submitted — the engines are
 * @siumora/core's scoreAddress/scoreRto/evaluateCod, imported, not copied
 * (see the serviceability module), so the two stacks cannot disagree by
 * re-implementation.
 *
 * Plan 16 Phase A (B8) adds, Medusa-only:
 * - `totals` {prepaid, cod|null, interState}: what the order will carry per
 *   method, in paise, from the same rules the completion route charges by
 *   (modules/siumora-order/checkout-rules.ts). The storefront shows these
 *   rather than computing its own.
 * - `cartVersion`: a fingerprint of the lines and prices, so a changed bag
 *   reads as "prices updated" instead of a silent new total.
 * `totals` is null when a line cannot carry a lawful invoice (no HSN or
 * slab) — the same refusal the invoice would make, surfaced before payment.
 *
 * Read-only, so the storefront can call it as the customer types. An
 * unknown cart quotes over a zero subtotal — the same outcome as Fastify's
 * getCartLines returning no lines — and an unknown pincode quotes
 * serviceable:false with COD withheld ("Not available for this pincode").
 */

interface CartWire {
  id: string;
  promotions?: Array<{ code?: string | null } | null> | null;
  items?: Array<(InvoiceLineWire & { id: string }) | null> | null;
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const parsed = parseQuoteBody(req.body);
  if (!parsed.ok) {
    // Shaped like the Fastify zod-failure 400s (app.ts setErrorHandler).
    res.status(400).json({ error: "invalid_request", message: parsed.message });
    return;
  }
  const body = parsed.value;

  const pg = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as SqlClient;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const signals = await customerSignals(req, body.phone);

  // ── Cart lines, integer paise (the transport's own money path). ──
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      // items.* rather than a field list: quantity is a computed field that
      // resolves undefined when named explicitly (probed on 2.18.0).
      "id",
      // The coupons applied (plan 16 B19), so the summary can show and remove them.
      "promotions.code",
      "items.*",
      "items.variant.id",
      "items.variant.metadata",
      "items.variant.product.metadata",
      "items.adjustments.amount",
    ],
    filters: { id: body.cartId },
  });
  const cart = carts[0] as CartWire | undefined;
  const items = (cart?.items ?? []).filter((item): item is InvoiceLineWire & { id: string } =>
    Boolean(item),
  );
  // Net of any coupon (plan 16 B19): the COD limits judge what is paid.
  const subtotalPaise = items.reduce(
    (sum, item) =>
      sum + linePaise(item).unitPrice * wireNumber(item.quantity, "quantity") - lineDiscountPaise(item),
    0,
  );

  const dial = await checkoutSettings(req);
  const row = await findPincode(pg, body.pincode);

  const quote = computeQuote({
    body,
    row,
    subtotalPaise,
    signals,
    limits: {
      minOrder: dial.codMinOrder,
      maxOrder: dial.codMaxOrder,
      fee: dial.codFee,
    },
  });

  let totals: ReturnType<typeof quoteTotals> | null = null;
  let version: string | null = null;
  if (items.length > 0) {
    try {
      const lines = toInvoiceLines(items);
      totals = quoteTotals(lines, { stateCode: body.stateCode, cod: quote.cod });
      version = cartVersion(lines);
    } catch {
      // A line without HSN/slab: the totals stay null rather than guessed.
    }
  }

  // Whether choosing COD will open the verify-your-number sheet (the gate in
  // lib/checkout-identity.ts) — told up front, so the storefront asks when
  // COD is chosen rather than surprising the shopper at Pay.
  const codNeedsVerification = dial.codRequiresOtp && !quote.phoneVerified;

  const coupons = (cart?.promotions ?? [])
    .map((promotion) => promotion?.code)
    .filter((code): code is string => typeof code === "string" && code.length > 0);

  res.json({ ...quote, totals, cartVersion: version, codNeedsVerification, coupons });
}
