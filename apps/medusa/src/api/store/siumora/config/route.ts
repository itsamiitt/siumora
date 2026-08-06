import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { readSettings, type SqlClient } from "../../../../modules/settings/read";
import {
  configEnvelope,
  createSettingsCache,
  type SettingsReader,
} from "../../../../modules/settings/settings";

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
 * same 30s in-process TTL the Fastify app uses. razorpayConfigured is env
 * presence — RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET both set — which is
 * precisely the condition under which the Fastify boot builds its payment
 * client and its /config says true.
 */

// Module-level like the Fastify server decoration: one cache per process.
// The pg connection it captures on first use is the container's singleton.
let cache: SettingsReader | undefined;

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const pg = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as SqlClient;
  cache ??= createSettingsCache(() => readSettings(pg));

  const settings = await cache.get();
  res.setHeader("Cache-Control", "no-store");
  res.json(configEnvelope(settings, process.env));
}
