import { createClient, type SiumoraClient } from "@siumora/sdk";
import { createMedusaClient, type MedusaClient } from "@siumora/sdk/medusa";

/**
 * The COMMERCE_BACKEND seam (design doc, Track M).
 *
 * `fastify` is today's path. `medusa` constructs the M1 Medusa transport —
 * the same public surface, catalogue and cart and COD checkout served by
 * Medusa's store API, everything not yet ported refusing with a structured
 * 501 not_ported rather than a wrong answer. An unknown value refuses
 * loudly, the same posture as apps/e2e's E2E_BACKEND refusal: a flipped
 * environment can never quietly keep serving the wrong backend.
 *
 * Server env only (never NEXT_PUBLIC_*), so the M5.7 cutover is this flip
 * plus a web rebuild with no client-bundle bake-in. The `server-only` guard
 * lives in api.ts — this module's sole importer — not here, so the decision
 * stays runnable under `node --test`.
 */
/** Whichever transport the flip selected — one public surface, two classes. */
export type CommerceClient = SiumoraClient | MedusaClient;

export function createCommerceClient(
  env: Record<string, string | undefined> = process.env,
): CommerceClient {
  const backend = env.COMMERCE_BACKEND ?? "fastify";
  if (backend === "medusa") {
    // Throws its own named error when MEDUSA_URL / MEDUSA_PUBLISHABLE_KEY
    // are missing — misconfiguration fails at construction, not mid-render.
    return createMedusaClient(env);
  }
  if (backend !== "fastify") {
    throw new Error(`COMMERCE_BACKEND must be fastify|medusa, got "${backend}"`);
  }
  return createClient(env);
}
