import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SETTING_DEFAULTS,
  SETTINGS_TTL_MS,
  configEnvelope,
  createSettingsCache,
  isSettingKey,
  mergeSettings,
  razorpayConfigured,
  type Settings,
} from "./settings.ts";

// The mirror's anchor: these values are copied from
// packages/db/src/settings-repository.ts SETTING_DEFAULTS (that package is
// the Fastify stack's and is deliberately not a dependency of this app, so
// the pin is by value with a pointer, not by import). If the Fastify
// defaults ever move, this test is the list of what to move with them.

// ── Defaults ──────────────────────────────────────────────────

test("payments are enabled by default — the Fastify truth, mirrored", () => {
  assert.equal(SETTING_DEFAULTS.paymentsEnabled, true);
});

test("the COD caps mirror the Fastify launch values", () => {
  assert.equal(SETTING_DEFAULTS.codMaxOrder, 500000); // ₹5,000 cap
  assert.equal(SETTING_DEFAULTS.codFee, 4900); // ₹49 fee
  assert.equal(SETTING_DEFAULTS.codMinOrder, 49900); // ₹499 floor
});

test("an empty table serves exactly the defaults", () => {
  assert.deepEqual(mergeSettings([]), SETTING_DEFAULTS);
});

// ── The merge: stored rows over defaults, garbage ignored ─────

test("a stored kill-switch row wins over the default", () => {
  const merged = mergeSettings([{ key: "payments_enabled", value: false }]);
  assert.equal(merged.paymentsEnabled, false);
  // Only the stored key moved; everything else stays default.
  assert.equal(merged.codMaxOrder, SETTING_DEFAULTS.codMaxOrder);
});

test("unknown keys are skipped, never served", () => {
  const merged = mergeSettings([{ key: "free_money", value: true }]);
  assert.deepEqual(merged, SETTING_DEFAULTS);
  assert.equal(isSettingKey("free_money"), false);
  assert.equal(isSettingKey("payments_enabled"), true);
});

test("a corrupted stored value degrades to the default, never crashes", () => {
  const merged = mergeSettings([
    { key: "payments_enabled", value: "no" }, // not a boolean
    { key: "cod_max_order", value: 1000.5 }, // not integer paise
    { key: "cod_fee", value: -1 }, // negative
    { key: "cod_min_order", value: 999_999_999 }, // above the paise ceiling
  ]);
  assert.deepEqual(merged, SETTING_DEFAULTS);
});

test("valid stored caps are served as stored", () => {
  const merged = mergeSettings([
    { key: "cod_max_order", value: 300000 },
    { key: "cod_fee", value: 0 },
  ]);
  assert.equal(merged.codMaxOrder, 300000);
  assert.equal(merged.codFee, 0);
});

// ── The public envelope ───────────────────────────────────────

test("configEnvelope carries exactly the recorded contract keys", () => {
  const envelope = configEnvelope(SETTING_DEFAULTS, {});
  assert.deepEqual(Object.keys(envelope).sort(), [
    "paymentsEnabled",
    "razorpayConfigured",
  ]);
  assert.equal(typeof envelope.paymentsEnabled, "boolean");
  assert.equal(typeof envelope.razorpayConfigured, "boolean");
});

test("the envelope reports the kill-switch as stored, and never the caps", () => {
  const paused: Settings = { ...SETTING_DEFAULTS, paymentsEnabled: false };
  const envelope = configEnvelope(paused, {});
  assert.equal(envelope.paymentsEnabled, false);
  assert.equal("codMaxOrder" in envelope, false);
});

test("razorpayConfigured needs both env halves, same as the Fastify boot", () => {
  // apps/api builds its client only when RAZORPAY_KEY_ID and
  // RAZORPAY_KEY_SECRET are both present; /config reports that presence.
  assert.equal(
    razorpayConfigured({ RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "s" }),
    true,
  );
  assert.equal(razorpayConfigured({ RAZORPAY_KEY_ID: "rzp_test_x" }), false);
  assert.equal(razorpayConfigured({ RAZORPAY_KEY_SECRET: "s" }), false);
  assert.equal(razorpayConfigured({}), false);
  // An empty string is not a credential (server.ts spreads only truthy envs).
  assert.equal(
    razorpayConfigured({ RAZORPAY_KEY_ID: "", RAZORPAY_KEY_SECRET: "s" }),
    false,
  );
});

// ── The TTL cache (mirror of apps/api/src/lib/settings.ts) ────

test("the cache serves within the TTL and reloads after it", async () => {
  let clock = 0;
  let loads = 0;
  const cache = createSettingsCache(
    async () => {
      loads += 1;
      return SETTING_DEFAULTS;
    },
    SETTINGS_TTL_MS,
    () => clock,
  );

  await cache.get();
  await cache.get();
  assert.equal(loads, 1); // second read served from cache

  clock += SETTINGS_TTL_MS - 1;
  await cache.get();
  assert.equal(loads, 1); // still inside the window

  clock += 1;
  await cache.get();
  assert.equal(loads, 2); // TTL elapsed — staleness is bounded
});

test("invalidate forces the next read to the database", async () => {
  let loads = 0;
  const cache = createSettingsCache(
    async () => {
      loads += 1;
      return SETTING_DEFAULTS;
    },
    SETTINGS_TTL_MS,
    () => 0,
  );

  await cache.get();
  cache.invalidate();
  await cache.get();
  assert.equal(loads, 2);
});
