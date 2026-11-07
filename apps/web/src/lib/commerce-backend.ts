import { createClient, type SiumoraClient } from "@siumora/sdk";
import { createMedusaClient, type MedusaClient } from "@siumora/sdk/medusa";

/**
 * The COMMERCE_BACKEND seam (design doc, Track M).
 *
 * `medusa` is the default and the launch path (plan 16 Phase J): the Medusa
 * transport, with everything not ported refusing with a structured 501
 * not_ported rather than a wrong answer. `fastify` stays selectable, by
 * name only, until scripts/retire-fastify.mjs removes it. An unknown value refuses
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
  medusa: Parameters<typeof createMedusaClient>[1] = {},
): CommerceClient {
  const backend = env.COMMERCE_BACKEND ?? "medusa";
  if (backend === "medusa") {
    // Throws its own named error when MEDUSA_URL / MEDUSA_PUBLISHABLE_KEY
    // are missing — misconfiguration fails at construction, not mid-render.
    return createMedusaClient(env, medusa);
  }
  if (backend !== "fastify") {
    throw new Error(`COMMERCE_BACKEND must be fastify|medusa, got "${backend}"`);
  }
  return createClient(env);
}
