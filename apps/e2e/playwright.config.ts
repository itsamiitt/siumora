import { defineConfig } from "@playwright/test";

import { e2eDatabaseUrl } from "./setup/db-url.ts";

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

/**
 * Track M (design doc M0): the suite is parameterized by backend. `fastify`
 * is today's path. `medusa` becomes runnable at M1, when the adapter gives
 * the storefront a Medusa transport — until then the flag refuses loudly
 * rather than pretending an untestable path passed. Refusing here, not
 * skipping tests, means CI can never report a vacuous medusa-green.
 */
const backend = process.env.E2E_BACKEND ?? "fastify";
if (backend === "medusa") {
  throw new Error(
    "E2E_BACKEND=medusa is not runnable until M1: the storefront needs the " +
      "Medusa transport (adapter) before these flows can exist. The `medusa` " +
      "CI job proves cold boot in the meantime.",
  );
}
if (backend !== "fastify") {
  throw new Error(`E2E_BACKEND must be fastify|medusa, got "${backend}"`);
}

const databaseUrl = e2eDatabaseUrl();

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
    {
      command: "node --experimental-strip-types src/server.ts",
      cwd: "../api",
      port: API_PORT,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        PORT: String(API_PORT),
        APP_ENV: "development",
        OTP_ECHO: "true",
        COURIER_SIMULATION: "true",
        // The suite is one IP hammering the money paths in seconds — exactly
        // the shape the shipped limits refuse. Boot-refused in production.
        DISABLE_RATE_LIMITS: "true",
        ADMIN_PHONES: "9000000001",
        CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
      },
    },
    {
      // A production build, not `next dev`: the dev server compiles routes and
      // server actions on first hit, which reads as flake (slow adds, cached
      // 404s) — and production is what the suite exists to prove anyway. The
      // build runs after the API is up because the storefront prerenders
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
        API_URL,
        NEXT_PUBLIC_API_URL: API_URL,
        // Never share .next with a developer's own running dev server.
        NEXT_DIST_DIR: ".next-e2e",
      },
    },
  ],
});
