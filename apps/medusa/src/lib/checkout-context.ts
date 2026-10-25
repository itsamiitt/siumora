import type { MedusaRequest } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import {
  ANONYMOUS_SIGNALS,
  type QuoteSignals,
} from "../modules/serviceability/serviceability";
import { settingsCache } from "../modules/settings/cache";
import { readSettings, type SqlClient as SettingsSqlClient } from "../modules/settings/read";
import { SETTING_DEFAULTS, type Settings } from "../modules/settings/settings";
import { siumoraOrderStatus } from "../modules/siumora-order/identity";

/**
 * The quote's and completion's view of the checkout: who is buying, and the
 * operator's dial (COD caps and fee, the kill-switch).
 */

/**
 * The settings dial behind the same 30s cache the kill-switch card uses.
 * When the settings table is not stood up yet (its migration runs with
 * registration) the compiled defaults answer — exactly what Fastify's
 * settings repository answers over an empty table.
 */
export async function checkoutSettings(req: MedusaRequest): Promise<Settings> {
  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  try {
    return await settingsCache(() => readSettings(pg as unknown as SettingsSqlClient)).get();
  } catch {
    return SETTING_DEFAULTS;
  }
}

/**
 * What a shopper's history contributes to the COD risk picture — read by
 * the quote and by completion, so the terms quoted are the terms charged.
 *
 * phoneVerified: false unless the signed-in customer's stored phone equals
 * the delivery one — the same strict comparison as Fastify's
 * customerSignals (an unverified number must not launder an address into
 * the lower risk band). The customer arrives via req.auth_context, which
 * the session door (src/lib/session-auth.ts, mounted on /store) sets for a
 * live storefront session. A guest is honestly anonymous.
 */
export async function customerSignals(
  req: MedusaRequest,
  phone: string | undefined,
): Promise<QuoteSignals> {
  const actorId = (req as { auth_context?: { actor_id?: string } }).auth_context?.actor_id;
  if (!actorId) return ANONYMOUS_SIGNALS;

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: customers } = await query.graph({
    entity: "customer",
    fields: ["id", "phone"],
    filters: { id: actorId },
  });
  const customer = customers[0] as { id: string; phone: string | null } | undefined;
  if (!customer) return ANONYMOUS_SIGNALS;

  const { data: past } = await query.graph({
    entity: "order",
    fields: ["id", "status"],
    filters: { customer_id: actorId },
  });
  return {
    // Strict equality against the stored (normalized) number, exactly
    // like Fastify — the delivery number must be the one they proved.
    phoneVerified: phone !== undefined && phone === customer.phone,
    isNewCustomer: past.length === 0,
    // "delivered" arrives with the M2 ops port's status vocabulary; until
    // then this count is honestly zero by construction
    // (confirmed-unless-cancelled), same as a new customer's history.
    successfulOrders: past.filter(
      (order) => siumoraOrderStatus((order as { status: string }).status) === "delivered",
    ).length,
  };
}
