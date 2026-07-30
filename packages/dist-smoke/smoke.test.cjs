/**
 * Dist smoke test — the Medusa stand-in.
 *
 * Every shared package is consumed two ways: Next and the Node apps read the
 * TypeScript source (the "import" condition), while Medusa's SWC-compiled CJS
 * output will require() the built dist (the "require" condition). All other
 * suites exercise the source path, so a broken or stale dist would ship with
 * CI fully green. This file is the only consumer of the "require" condition
 * until apps/medusa exists — if it passes, a CJS consumer gets working code.
 *
 * Deliberately .cjs: require() must be the real CJS resolution, not ESM.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");

const surfaces = [
  ["@siumora/core", ["extractGst", "calculateTotals", "evaluateCod"]],
  ["@siumora/core/auth", ["OTP_LENGTH", "SESSION_TTL_SECONDS"]],
  ["@siumora/core/facets", ["parseFilters", "priceFacets"]],
  ["@siumora/core/gstin", ["isValidGstin", "gstinStateCode"]],
  ["@siumora/db", ["createPool", "createDb", "migrate", "MIGRATIONS", "schema"]],
  ["@siumora/db/schema", []],
  ["@siumora/messaging", ["createOtpSender", "createSmsClient"]],
  ["@siumora/analytics", []],
  ["@siumora/analytics/server", ["buildGa4Payload", "buildMetaPayload"]],
  ["@siumora/sdk", ["SiumoraClient", "ApiError"]],
  ["@siumora/seo", ["SITE", "AI_CRAWLERS"]],
  ["@siumora/in-locale", ["isValidPincode"]],
];

for (const [specifier, expected] of surfaces) {
  test(`require("${specifier}") resolves to a working dist`, () => {
    const mod = require(specifier);
    assert.ok(mod && typeof mod === "object", `${specifier} did not resolve to a module object`);
    assert.ok(Object.keys(mod).length > 0, `${specifier} resolved to an empty module`);
    for (const name of expected) {
      assert.ok(name in mod, `${specifier} is missing export "${name}"`);
    }
  });
}
