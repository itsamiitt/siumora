import assert from "node:assert/strict";
import { test } from "node:test";

import { assertBootSafety } from "../app.ts";
import { resolveAppEnv } from "./env.ts";

test("APP_ENV wins over NODE_ENV for every tier", () => {
  assert.equal(resolveAppEnv({ APP_ENV: "staging", NODE_ENV: "production" }), "staging");
  assert.equal(resolveAppEnv({ APP_ENV: "production" }), "production");
  assert.equal(resolveAppEnv({ APP_ENV: "development", NODE_ENV: "production" }), "development");
});

test("without APP_ENV the tier derives from NODE_ENV", () => {
  assert.equal(resolveAppEnv({ NODE_ENV: "production" }), "production");
  assert.equal(resolveAppEnv({ NODE_ENV: "test" }), "development");
  assert.equal(resolveAppEnv({}), "development");
});

test("a typo'd APP_ENV refuses to boot rather than becoming development", () => {
  assert.throws(() => resolveAppEnv({ APP_ENV: "prod" }), /APP_ENV must be one of/);
});

// Regression (a): the OTP echo guard moved off NODE_ENV and must still refuse
// a production boot — a deploy that echoes sign-in codes is every account.
test("OTP_ECHO refuses to boot in production", () => {
  assert.throws(
    () => assertBootSafety({ appEnv: "production", otpEcho: true }),
    /OTP_ECHO must not be set in production/,
  );
});

// Regression (b): staging is the environment the launch-gate drills run in —
// both development conveniences must be permitted there.
test("staging permits the OTP echo and the courier simulation", () => {
  assert.doesNotThrow(() =>
    assertBootSafety({ appEnv: "staging", otpEcho: true, courierSimulation: true }),
  );
  assert.doesNotThrow(() =>
    assertBootSafety({ otpEcho: true, courierSimulation: true }),
  );
});

// Regression (c): an explicit COURIER_SIMULATION=true in production would let
// a customer mark their own parcel delivered — refuse at boot.
test("an explicit courier simulation refuses to boot in production", () => {
  assert.throws(
    () => assertBootSafety({ appEnv: "production", courierSimulation: true }),
    /COURIER_SIMULATION must not be enabled in production/,
  );
});

// Same class as the OTP echo: an unlimited production API is an open one.
test("disabled rate limits refuse to boot in production", () => {
  assert.throws(
    () => assertBootSafety({ appEnv: "production", disableRateLimits: true }),
    /DISABLE_RATE_LIMITS/,
  );
  assert.doesNotThrow(() =>
    assertBootSafety({ appEnv: "development", disableRateLimits: true }),
  );
});

test("a clean production config boots", () => {
  assert.doesNotThrow(() => assertBootSafety({ appEnv: "production" }));
});
