import { createClient, SiumoraClient } from "@siumora/sdk";

/**
 * The COMMERCE_BACKEND seam (design doc, Track M).
 *
 * `fastify` is today's path. `medusa` becomes constructible at M1, when the
 * adapter gives the storefront a Medusa transport — until then the flag
 * refuses loudly at construction rather than falling back, the same posture
 * as apps/e2e's E2E_BACKEND refusal: a flipped environment can never quietly
 * keep serving the wrong backend.
 *
 * Server env only (never NEXT_PUBLIC_*), so the M5.7 cutover is this flip
 * plus a web rebuild with no client-bundle bake-in. The `server-only` guard
 * lives in api.ts — this module's sole importer — not here, so the decision
 * stays runnable under `node --test`.
 */
export function createCommerceClient(
  env: Record<string, string | undefined> = process.env,
): SiumoraClient {
  const backend = env.COMMERCE_BACKEND ?? "fastify";
  if (backend === "medusa") {
    throw new Error(
      "COMMERCE_BACKEND=medusa is not servable until M1: the storefront " +
        "needs the Medusa transport (adapter), which lands with M1 " +
        "completion. Refusing here beats silently serving the wrong backend.",
    );
  }
  if (backend !== "fastify") {
    throw new Error(`COMMERCE_BACKEND must be fastify|medusa, got "${backend}"`);
  }
  return createClient(env);
}
