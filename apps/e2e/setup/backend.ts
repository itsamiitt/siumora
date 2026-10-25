import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Which backend the suite drives (plan 16 Phase J). `medusa` is the launch
 * path; `fastify` stays selectable until Fastify is retired
 * (scripts/retire-fastify.mjs). Anything else refuses loudly — CI must never
 * report a vacuous green for a backend it did not run.
 */
export type E2EBackend = "fastify" | "medusa";

export function e2eBackend(env: Record<string, string | undefined> = process.env): E2EBackend {
  const backend = env.E2E_BACKEND ?? "medusa";
  if (backend !== "fastify" && backend !== "medusa") {
    throw new Error(`E2E_BACKEND must be fastify|medusa, got "${backend}"`);
  }
  return backend;
}

export const MEDUSA_PORT = 9123;
export const MEDUSA_URL = `http://localhost:${MEDUSA_PORT}`;

/** Written by setup/prepare-medusa.ts after the seed: the store's publishable key. */
export const MEDUSA_KEY_FILE = fileURLToPath(new URL("../.medusa-e2e.json", import.meta.url));

export function medusaPublishableKey(): string {
  if (!existsSync(MEDUSA_KEY_FILE)) {
    throw new Error("No .medusa-e2e.json — run the suite through `pnpm test:e2e`, which seeds Medusa first.");
  }
  return (JSON.parse(readFileSync(MEDUSA_KEY_FILE, "utf8")) as { publishableKey: string }).publishableKey;
}
