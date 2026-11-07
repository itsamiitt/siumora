import { test } from "node:test";
import assert from "node:assert/strict";

import { DEV_SECRET, DEV_TOKEN_SECRET, assertMedusaBootSafety, resolveAppEnv, resolveWorkerMode } from "./boot-guards.ts";

const PROD_OK = {
  APP_ENV: "production",
  JWT_SECRET: "real-jwt-secret",
  COOKIE_SECRET: "real-cookie-secret",
  MEDUSA_DATABASE_URL: "postgresql://u:p@db:5432/siumora_medusa",
  MEDUSA_REDIS_URL: "redis://cache:6379",
  SETTINGS_ENCRYPTION_KEY: "k".repeat(32),
  S3_FILE_URL: "https://images.siumora.in",
  S3_ACCESS_KEY_ID: "id",
  S3_SECRET_ACCESS_KEY: "secret",
  S3_BUCKET: "siumora",
  STOREFRONT_URL: "https://siumora.in",
  STORE_CORS: "https://siumora.in",
  ADMIN_CORS: "https://api.siumora.in",
  AUTH_CORS: "https://siumora.in,https://api.siumora.in",
  ADMIN_USER_ROLES: "owner@siumora.in:owner,ops@siumora.in:operator",
  TURNSTILE_SECRET_KEY: "turnstile",
  CLIENT_IP_SECRET: "c".repeat(32),
};

test("development boots with no env at all", () => {
  const r = assertMedusaBootSafety({});
  assert.equal(r.appEnv, "development");
  assert.equal(r.jwtSecret, DEV_SECRET);
});

test("staging boots on dev secrets — staging is not production", () => {
  const r = assertMedusaBootSafety({ APP_ENV: "staging" });
  assert.equal(r.appEnv, "staging");
});

test("unknown APP_ENV refused", () => {
  assert.throws(() => resolveAppEnv({ APP_ENV: "prod" }), /APP_ENV must be/);
});

test("production boots with real secrets and a database URL", () => {
  const r = assertMedusaBootSafety(PROD_OK);
  assert.equal(r.appEnv, "production");
});

test("production refuses dev-default JWT secret", () => {
  assert.throws(
    () => assertMedusaBootSafety({ ...PROD_OK, JWT_SECRET: undefined }),
    /dev defaults/,
  );
});

test("production refuses dev-default cookie secret", () => {
  assert.throws(
    () => assertMedusaBootSafety({ ...PROD_OK, COOKIE_SECRET: undefined }),
    /dev defaults/,
  );
});

test("production refuses a missing database URL", () => {
  assert.throws(
    () => assertMedusaBootSafety({ ...PROD_OK, MEDUSA_DATABASE_URL: undefined }),
    /MEDUSA_DATABASE_URL/,
  );
});

test("production refuses a missing Redis URL", () => {
  // Per-process rate-limit counters would multiply the OTP endpoint's
  // ceiling by the instance count and reset on every restart.
  assert.throws(
    () => assertMedusaBootSafety({ ...PROD_OK, MEDUSA_REDIS_URL: undefined }),
    /MEDUSA_REDIS_URL/,
  );
});

test("development and staging boot without Redis", () => {
  assert.doesNotThrow(() => assertMedusaBootSafety({}));
  assert.doesNotThrow(() => assertMedusaBootSafety({ APP_ENV: "staging" }));
});

test("production refuses the courier simulation and OTP echo", () => {
  assert.throws(() => assertMedusaBootSafety({ ...PROD_OK, COURIER_SIMULATION: "true" }), /COURIER_SIMULATION/);
  assert.throws(() => assertMedusaBootSafety({ ...PROD_OK, OTP_ECHO: "true" }), /OTP_ECHO/);
  assert.equal(assertMedusaBootSafety({ ...PROD_OK, COURIER_SIMULATION: "false" }).appEnv, "production");
  assert.equal(
    assertMedusaBootSafety({ APP_ENV: "staging", COURIER_SIMULATION: "true", OTP_ECHO: "true" }).appEnv,
    "staging",
  );
});

test("NODE_ENV=production without APP_ENV is refused, not silently development", () => {
  assert.throws(() => resolveAppEnv({ NODE_ENV: "production" }), /APP_ENV is not set/);
  assert.throws(() => assertMedusaBootSafety({ ...PROD_OK, APP_ENV: undefined, NODE_ENV: "production" }), /APP_ENV/);
  assert.equal(resolveAppEnv({ NODE_ENV: "production", APP_ENV: "staging" }), "staging");
  assert.equal(resolveAppEnv({ NODE_ENV: "development" }), "development");
});

test("production refuses each missing required setting", () => {
  for (const key of [
    "SETTINGS_ENCRYPTION_KEY",
    "S3_FILE_URL",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_BUCKET",
    "STOREFRONT_URL",
    "STORE_CORS",
    "ADMIN_CORS",
    "AUTH_CORS",
    "ADMIN_USER_ROLES",
    "TURNSTILE_SECRET_KEY",
    "CLIENT_IP_SECRET",
  ] as const) {
    assert.throws(() => assertMedusaBootSafety({ ...PROD_OK, [key]: undefined }), new RegExp(key), key);
  }
});

test("production refuses short secrets, localhost origins and an owner-less role list", () => {
  assert.throws(() => assertMedusaBootSafety({ ...PROD_OK, SETTINGS_ENCRYPTION_KEY: "short" }), /SETTINGS_ENCRYPTION_KEY/);
  assert.throws(() => assertMedusaBootSafety({ ...PROD_OK, CLIENT_IP_SECRET: "short" }), /CLIENT_IP_SECRET/);
  assert.throws(() => assertMedusaBootSafety({ ...PROD_OK, STORE_CORS: "http://localhost:3000" }), /STORE_CORS points at localhost/);
  assert.throws(() => assertMedusaBootSafety({ ...PROD_OK, STOREFRONT_URL: "http://127.0.0.1:3000" }), /STOREFRONT_URL/);
  assert.throws(() => assertMedusaBootSafety({ ...PROD_OK, ADMIN_USER_ROLES: "ops@siumora.in:operator" }), /ADMIN_USER_ROLES/);
});

test("production refuses the dev signed-token secret", () => {
  assert.throws(() => assertMedusaBootSafety({ ...PROD_OK, SIUMORA_TOKEN_SECRET: DEV_TOKEN_SECRET }), /SIUMORA_TOKEN_SECRET/);
  assert.throws(() => assertMedusaBootSafety({ ...PROD_OK, SIUMORA_TOKEN_SECRET: DEV_SECRET }), /SIUMORA_TOKEN_SECRET/);
  assert.doesNotThrow(() => assertMedusaBootSafety({ ...PROD_OK, SIUMORA_TOKEN_SECRET: "t".repeat(40) }));
});

test("worker mode defaults to shared and refuses unknown values", () => {
  assert.equal(resolveWorkerMode({}), "shared");
  assert.equal(resolveWorkerMode({ MEDUSA_WORKER_MODE: "worker" }), "worker");
  assert.equal(assertMedusaBootSafety({ MEDUSA_WORKER_MODE: "server" }).workerMode, "server");
  assert.throws(() => resolveWorkerMode({ MEDUSA_WORKER_MODE: "both" }), /MEDUSA_WORKER_MODE/);
});
