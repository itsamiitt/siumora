import { defineConfig } from "@playwright/test";

import { MEDUSA_PORT, MEDUSA_URL, e2eBackend, medusaPublishableKey } from "./setup/backend.ts";
import { e2eDatabaseUrl, medusaE2eDatabaseUrl } from "./setup/db-url.ts";

/**
 * The E2E harness (plan 6A): its own database, its own API, its own web
 * server, on ports nothing else uses — a run must never depend on, or
 * corrupt, whatever a developer happens to have running.
 *
 * Serial on purpose: the kill-switch test flips global state, and three
 * browser tests do not earn a worker pool.
 */

export const API_PORT = 4123;
export const WEB_PORT = 3123;
export const API_URL = `http://localhost:${API_PORT}`;
export { MEDUSA_URL };

/**
 * Parameterized by backend (plan 16 Phase J): `medusa` — the launch path,
 * and the default — or `fastify` until it is retired. setup/prepare.ts has
 * already made the matching fresh database before this config loads.
 */
export const BACKEND = e2eBackend();

/** The switches both backends run the suite under. Boot-refused in production. */
const DEV_SWITCHES = {
  APP_ENV: "development",
  OTP_ECHO: "true",
  COURIER_SIMULATION: "true",
  // The suite is one IP hammering the money paths in seconds — exactly the
  // shape the shipped limits refuse.
  DISABLE_RATE_LIMITS: "true",
  ADMIN_PHONES: "9000000001",
};

const fastifyServer = () => ({
  command: "node --experimental-strip-types src/server.ts",
  cwd: "../api",
  port: API_PORT,
  reuseExistingServer: false,
  timeout: 60_000,
  env: {
    ...process.env,
    ...DEV_SWITCHES,
    DATABASE_URL: e2eDatabaseUrl(),
    PORT: String(API_PORT),
    CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
  },
});

const medusaServer = () => ({
  // `develop`, as the CI medusa job boots it: no build step to keep in sync.
  command: `npx medusa develop --port ${MEDUSA_PORT}`,
  cwd: "../medusa",
  url: `${MEDUSA_URL}/health`,
  reuseExistingServer: false,
  timeout: 180_000,
  env: {
    ...process.env,
    ...DEV_SWITCHES,
    MEDUSA_DATABASE_URL: medusaE2eDatabaseUrl(),
    PORT: String(MEDUSA_PORT),
    STORE_CORS: `http://localhost:${WEB_PORT}`,
    AUTH_CORS: `http://localhost:${WEB_PORT}`,
    STOREFRONT_URL: `http://localhost:${WEB_PORT}`,
    // Placeholder seller details so an invoice can issue.
    SELLER_NAME: "Siumora (e2e)",
    SELLER_ADDRESS: "1 Marine Drive, Mumbai 400001",
    SELLER_GSTIN: "27ABCDE1234F1Z5",
    SELLER_STATE_CODE: "27",
    SELLER_EMAIL: "e2e@siumora.example",
    SELLER_PHONE: "9000000000",
  },
});

const backendEnv = (): Record<string, string> =>
  BACKEND === "medusa"
    ? { COMMERCE_BACKEND: "medusa", MEDUSA_URL, MEDUSA_PUBLISHABLE_KEY: medusaPublishableKey() }
    : { COMMERCE_BACKEND: "fastify", API_URL, NEXT_PUBLIC_API_URL: API_URL };

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  webServer: [
    BACKEND === "medusa" ? medusaServer() : fastifyServer(),
    {
      // A production build, not `next dev`: the dev server compiles routes and
      // server actions on first hit, which reads as flake (slow adds, cached
      // 404s) — and production is what the suite exists to prove anyway. The
      // build runs after the backend is up because the storefront prerenders
      // catalog pages by calling it.
      // keepAliveTimeout raised past the browser's socket-reuse window: the
      // default closes idle keep-alive sockets exactly as the client reuses
      // one for a server-action stream — the client sees "Connection closed."
      // and the error boundary eats the page. Production sits behind a proxy
      // with aligned timeouts; this is the same alignment, locally.
      command: `pnpm exec next build && pnpm exec next start -p ${WEB_PORT} --keepAliveTimeout 70000`,
      cwd: "../web",
      port: WEB_PORT,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        ...process.env,
        ...backendEnv(),
        // Never share .next with a developer's own running dev server.
        NEXT_DIST_DIR: ".next-e2e",
      },
    },
  ],
});
