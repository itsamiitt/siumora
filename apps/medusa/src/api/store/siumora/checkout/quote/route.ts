import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { findPincode, type SqlClient } from "../../../../../modules/serviceability/lookup";
import {
  ANONYMOUS_SIGNALS,
  computeQuote,
  parseQuoteBody,
  type QuoteSignals,
} from "../../../../../modules/serviceability/serviceability";
import {
  linePaise,
  siumoraOrderStatus,
  wireNumber,
  type OrderLineWire,
} from "../../../../../modules/siumora-order/identity";
import { readSettings, type SqlClient as SettingsSqlClient } from "../../../../../modules/settings/read";
import { SETTING_DEFAULTS } from "../../../../../modules/settings/settings";

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
 * Read-only, so the storefront can call it as the customer types. An
 * unknown cart quotes over a zero subtotal — the same outcome as Fastify's
 * getCartLines returning no lines — and an unknown pincode quotes
 * serviceable:false with COD withheld ("Not available for this pincode").
 *
 * COD caps: the settings module's dial (siumora_settings) when its table
 * exists, else its compiled defaults — the same values Fastify's settings
 * repository defaults to, so an unconfigured stack quotes identically.
 *
 * phoneVerified: false unless the signed-in customer's stored phone equals
 * the submitted one — the same strict comparison as Fastify's
 * customerSignals (an unverified number must not launder an address into
 * the lower risk band). The customer arrives via req.auth_context when
 * Medusa's authenticate() middleware populates it; store routes get no
 * authenticate() by default, and middlewares.ts is owned elsewhere — until
 * an `authenticate("customer", ["bearer", "session"], { allowUnauthenticated:
 * true })` entry covers this route, every caller is honestly anonymous
 * (phoneVerified:false, isNewCustomer:true, successfulOrders:0), which is
 * also the correct answer for every guest.
 */

interface CartWire {
  id: string;
  items?: Array<(OrderLineWire & { id: string }) | null> | null;
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

  // ── Customer signals (see header: anonymous unless auth_context). ──
  let signals: QuoteSignals = ANONYMOUS_SIGNALS;
  const actorId = (req as { auth_context?: { actor_id?: string } }).auth_context
    ?.actor_id;
  if (actorId) {
    const { data: customers } = await query.graph({
      entity: "customer",
      fields: ["id", "phone"],
      filters: { id: actorId },
    });
    const customer = customers[0] as { id: string; phone: string | null } | undefined;
    if (customer) {
      const { data: past } = await query.graph({
        entity: "order",
        fields: ["id", "status"],
        filters: { customer_id: actorId },
      });
      signals = {
        // Strict equality against the stored (normalized) number, exactly
        // like Fastify — the delivery number must be the one they proved.
        phoneVerified: body.phone !== undefined && body.phone === customer.phone,
        isNewCustomer: past.length === 0,
        // "delivered" arrives with the M2 ops port's status vocabulary;
        // until then this count is honestly zero by construction
        // (confirmed-unless-cancelled), same as a new customer's history.
        successfulOrders: past.filter(
          (order) => siumoraOrderStatus((order as { status: string }).status) === "delivered",
        ).length,
      };
    }
  }

  // ── Cart subtotal, integer paise (the transport's own money path). ──
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      // items.* rather than a field list: quantity is a computed field that
      // resolves undefined when named explicitly (probed on 2.18.0).
      "id",
      "items.*",
      "items.variant.id",
      "items.variant.metadata",
    ],
    filters: { id: body.cartId },
  });
  const cart = carts[0] as CartWire | undefined;
  const lines = (cart?.items ?? []).filter(Boolean);
  const subtotalPaise = lines.reduce(
    (sum, item) =>
      sum + linePaise(item!).unitPrice * wireNumber(item!.quantity, "quantity"),
    0,
  );

  // ── The COD dial: settings table when present, defaults otherwise. ──
  let dial = SETTING_DEFAULTS;
  try {
    dial = await readSettings(pg as unknown as SettingsSqlClient);
  } catch {
    // The settings module's table is not stood up yet (its migration runs
    // with registration) — the compiled defaults are exactly what Fastify's
    // settings repository answers over an empty table.
  }

  const row = await findPincode(pg, body.pincode);

  res.json(
    computeQuote({
      body,
      row,
      subtotalPaise,
      signals,
      limits: {
        minOrder: dial.codMinOrder,
        maxOrder: dial.codMaxOrder,
        fee: dial.codFee,
      },
    }),
  );
}
