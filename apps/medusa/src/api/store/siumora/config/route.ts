import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { razorpayCredentials } from "../../../../modules/razorpay-payment/credentials";
import { settingsCache } from "../../../../modules/settings/cache";
import { readSettings, type SqlClient } from "../../../../modules/settings/read";
import { configEnvelope } from "../../../../modules/settings/settings";

/**
 * GET /store/siumora/config — the kill-switch card.
 *
 * The Medusa port of the Fastify GET /config (apps/api/src/routes/
 * settings.ts): the storefront reads it per request to decide whether
 * checkout is open, so the envelope is exactly the two keys the recorded
 * contract pins — { paymentsEnabled, razorpayConfigured } — and the response
 * must never be cached by anything between the API and the page. A
 * kill-switch behind a CDN TTL is not a kill-switch: Cache-Control no-store.
 *
 * paymentsEnabled comes from the siumora_settings table merged over the
 * in-code defaults (enabled unless an operator stored otherwise), behind the
 * same 30s in-process TTL the Fastify app uses. razorpayConfigured is the
 * Razorpay provider's own readiness (plan 16 Phase B): key id and secret
 * present in the encrypted provider settings or the environment, and the
 * provider not switched off in the admin — exactly the condition under which
 * the prepare route opens a payment.
 *
 * Medusa adds `checkout` beside the pinned pair (plan 16 Phase I): which
 * optional checkout pieces the operator switched on — the gift message and
 * the cart-reminder opt-in — so the storefront offers only what is live.
 */

// One cache per process, shared with the admin settings PATCH (which
// invalidates it) — modules/settings/cache.ts. The pg connection it captures
// on first use is the container's singleton.
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const pg = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as SqlClient;
  const cache = settingsCache(() => readSettings(pg));

  const [settings, razorpay] = await Promise.all([
    cache.get(),
    razorpayCredentials(pg as unknown as Parameters<typeof razorpayCredentials>[0]),
  ]);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ...configEnvelope(settings, process.env),
    razorpayConfigured: razorpay.configured,
    checkout: {
      giftMessage: settings.giftMessageEnabled,
      cartReminders: settings.cartRecoveryEnabled,
    },
  });
}
