import { test } from "node:test";
import assert from "node:assert/strict";

import { DEV_SECRET, assertMedusaBootSafety, resolveAppEnv } from "./boot-guards.ts";

const PROD_OK = {
  APP_ENV: "production",
  JWT_SECRET: "real-jwt-secret",
  COOKIE_SECRET: "real-cookie-secret",
  MEDUSA_DATABASE_URL: "postgresql://u:p@db:5432/siumora_medusa",
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
