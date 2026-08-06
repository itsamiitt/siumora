import { test } from "node:test";
import assert from "node:assert/strict";

import { PINCODES } from "./pincodes.ts";
import {
  ANONYMOUS_SIGNALS,
  UNKNOWN_ESTIMATED_DAYS,
  computeQuote,
  isWellFormedPincode,
  parseQuoteBody,
  pincodeCard,
  type PincodeRow,
} from "./serviceability.ts";

// Dynamic on purpose: this app typechecks as CJS and core's static surface
// is ESM; a dynamic import is legal from both worlds. These pins are what
// make the quote's parity claim honest — computeQuote must produce exactly
// what core's engines produce for the same inputs.
const corePromise = import("@siumora/core");

/**
 * The COD dial the routes pass when the settings table is absent —
 * the settings module's SETTING_DEFAULTS, which mirror packages/db/src/
 * settings-repository.ts. minOrder and fee coincide with core's compiled
 * COD constants (pinned below); maxOrder is the launch cap ₹5,000 from the
 * eng review, deliberately BELOW core's compiled ceiling.
 */
const LAUNCH_LIMITS = { minOrder: 49900, maxOrder: 500000, fee: 4900 };

/** The metro row as the wire serves it (snake_case, serviceable default). */
const MUMBAI_ROW: PincodeRow = {
  pincode: "400001",
  city: "Mumbai",
  state_code: "27",
  serviceable: true,
  cod_available: true,
  estimated_days: "2-3",
  rto_rate_bps: 400,
};

/** The address the recorded contract quotes with (sdk-contract.test.ts). */
const CONTRACT_ADDRESS = {
  address: "Flat 3B, Sunrise Apartments, Linking Road",
  city: "Mumbai",
  stateCode: "27",
};

// ── Pins against @siumora/core ────────────────────────────────

test("the launch COD floor and fee are core's compiled constants", async () => {
  const core = await corePromise;
  assert.equal(LAUNCH_LIMITS.minOrder, core.COD_MIN_ORDER);
  assert.equal(LAUNCH_LIMITS.fee, core.COD_FEE);
  // maxOrder is the ₹5,000 launch cap (settings dial), deliberately below
  // core's compiled COD_MAX_ORDER — the dial only ever tightens the default.
  assert.ok(LAUNCH_LIMITS.maxOrder < core.COD_MAX_ORDER);
});

// ── The pincode shape: the 400 arm ────────────────────────────

test("well-formed pincodes pass — including unknown-but-valid ones", () => {
  for (const good of ["400001", "110001", "999999", "781001"]) {
    assert.equal(isWellFormedPincode(good), true, good);
  }
});

test("malformed pincodes are refused as 400 material, never queried", () => {
  for (const bad of [
    "12", // the recorded contract's malformed case
    "",
    "046001", // leading zero — no Indian pincode starts with 0
    "4000011", // seven digits
    "40000a",
    " 400001", // the route does not trim; zod did not either
  ]) {
    assert.equal(isWellFormedPincode(bad), false, JSON.stringify(bad));
  }
});

// ── The pincode card: both arms of the recorded contract ──────

test("a known pincode answers the full seven-key card, camelCase", () => {
  const card = pincodeCard("400001", MUMBAI_ROW);
  assert.deepEqual(Object.keys(card).sort(), [
    "city",
    "codAvailable",
    "estimatedDays",
    "pincode",
    "rtoRateBps",
    "serviceable",
    "stateCode",
  ]);
  assert.deepEqual(card, {
    pincode: "400001",
    city: "Mumbai",
    stateCode: "27",
    serviceable: true,
    codAvailable: true,
    estimatedDays: "2-3",
    rtoRateBps: 400,
  });
});

test("an unknown pincode is not serviceable — the exact Fastify literal", () => {
  assert.deepEqual(pincodeCard("999999", undefined), {
    pincode: "999999",
    serviceable: false,
    codAvailable: false,
    estimatedDays: UNKNOWN_ESTIMATED_DAYS,
    rtoRateBps: 0,
  });
  // The em dash, deliberately the same character the Fastify route serves.
  assert.equal(UNKNOWN_ESTIMATED_DAYS, "—");
});

// ── The ported seed rows ──────────────────────────────────────

test("the ported PINCODES are the five canonical rows, well-formed", () => {
  assert.equal(PINCODES.length, 5);
  assert.equal(new Set(PINCODES.map((row) => row.pincode)).size, 5);
  for (const row of PINCODES) {
    assert.equal(isWellFormedPincode(row.pincode), true, row.pincode);
    assert.match(row.stateCode, /^\d{2}$/);
    assert.ok(Number.isInteger(row.rtoRateBps) && row.rtoRateBps >= 0);
  }
  const mumbai = PINCODES.find((row) => row.pincode === "400001")!;
  assert.deepEqual(mumbai, {
    pincode: "400001",
    city: "Mumbai",
    stateCode: "27",
    codAvailable: true,
    estimatedDays: "2-3",
    rtoRateBps: 400,
  });
  // Guwahati is the no-COD lane — the row the COD refusal tests lean on.
  assert.equal(PINCODES.find((row) => row.pincode === "781001")!.codAvailable, false);
});

// ── Customer signals ──────────────────────────────────────────

test("anonymous signals are exactly Fastify's no-viewer arm", () => {
  assert.deepEqual(ANONYMOUS_SIGNALS, {
    phoneVerified: false,
    isNewCustomer: true,
    successfulOrders: 0,
  });
});

// ── The quote body: the 400 arm ───────────────────────────────

test("parseQuoteBody accepts the contract-shaped body and strips strays", () => {
  const parsed = parseQuoteBody({
    cartId: "cart_01ABC",
    pincode: "400001",
    ...CONTRACT_ADDRESS,
    phone: "9876543210",
    forged: "ignored",
  });
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value, {
    cartId: "cart_01ABC",
    pincode: "400001",
    address: CONTRACT_ADDRESS.address,
    city: "Mumbai",
    stateCode: "27",
    phone: "9876543210",
  });
});

test("parseQuoteBody refuses what the Fastify zod schema refuses", () => {
  for (const [body, needle] of [
    [undefined, /cartId/],
    [{ pincode: "400001" }, /cartId/],
    [{ cartId: "cart_x", pincode: "12" }, /pincode/],
    [{ cartId: "cart_x" }, /pincode/],
    [{ cartId: "cart_x", pincode: "400001", stateCode: "271" }, /stateCode/],
    [{ cartId: "cart_x", pincode: "400001", phone: "9".repeat(21) }, /phone/],
    [{ cartId: "cart_x", pincode: "400001", address: "a".repeat(301) }, /address/],
    [{ cartId: "cart_x", pincode: "400001", city: 42 }, /city/],
  ] as const) {
    const parsed = parseQuoteBody(body);
    assert.equal(parsed.ok, false, JSON.stringify(body));
    assert.match((parsed as { message: string }).message, needle);
  }
});

// ── The quote envelope: the recorded contract, key for key ────

test("a metro quote carries exactly the contract keys, engines included", async () => {
  const core = await corePromise;
  const body = { cartId: "cart_01ABC", pincode: "400001", ...CONTRACT_ADDRESS };
  // Two Petal Studs (Gold) — the contract suite's cartWithItem subtotal.
  const subtotalPaise = 2 * 199000;

  const quote = computeQuote({
    body,
    row: MUMBAI_ROW,
    subtotalPaise,
    signals: ANONYMOUS_SIGNALS,
    limits: LAUNCH_LIMITS,
  });

  assert.deepEqual(Object.keys(quote).sort(), [
    "addressQuality",
    "cod",
    "estimatedDays",
    "phoneVerified",
    "rto",
    "serviceable",
  ]);
  assert.deepEqual(Object.keys(quote.addressQuality).sort(), [
    "issues",
    "needsReview",
    "score",
  ]);
  assert.deepEqual(Object.keys(quote.rto).sort(), ["risk", "score"]);

  assert.equal(quote.serviceable, true);
  assert.equal(quote.estimatedDays, "2-3");
  assert.equal(quote.phoneVerified, false);

  // Parity by construction, proven: the same core engines over the same
  // inputs produce the same sub-shapes.
  const quality = core.scoreAddress({
    line1: body.address,
    city: body.city,
    stateCode: body.stateCode,
    pincode: body.pincode,
  });
  assert.deepEqual(quote.addressQuality, quality);

  const risk = core.scoreRto({
    paymentMethod: "cod",
    orderValue: subtotalPaise,
    addressScore: quality.score,
    phoneVerified: false,
    isNewCustomer: true,
    pincodeRtoRate: MUMBAI_ROW.rto_rate_bps / 10_000,
  });
  assert.deepEqual(quote.rto, { risk: risk.risk, score: risk.score });

  assert.deepEqual(
    quote.cod,
    core.evaluateCod({
      subtotal: subtotalPaise,
      pincodeCodServiceable: true,
      rtoRisk: risk.risk,
      successfulOrders: 0,
      limits: LAUNCH_LIMITS,
    }),
  );
  assert.equal(quote.cod.available, true);
});

test("an unknown pincode quotes unserviceable and withholds COD", async () => {
  const core = await corePromise;
  const quote = computeQuote({
    body: { cartId: "cart_01ABC", pincode: "999999" },
    row: undefined,
    subtotalPaise: 199000,
    signals: ANONYMOUS_SIGNALS,
    limits: LAUNCH_LIMITS,
  });
  assert.equal(quote.serviceable, false);
  assert.equal(quote.estimatedDays, UNKNOWN_ESTIMATED_DAYS);
  assert.equal(quote.cod.available, false);
  assert.deepEqual(
    quote.cod,
    core.evaluateCod({
      subtotal: 199000,
      pincodeCodServiceable: false,
      rtoRisk: quote.rto.risk,
      successfulOrders: 0,
      limits: LAUNCH_LIMITS,
    }),
  );
});

test("a verified phone flows through to the envelope and the risk score", () => {
  const body = { cartId: "cart_01ABC", pincode: "400001", ...CONTRACT_ADDRESS };
  const base = { body, row: MUMBAI_ROW, subtotalPaise: 199000, limits: LAUNCH_LIMITS };
  const unverified = computeQuote({ ...base, signals: ANONYMOUS_SIGNALS });
  const verified = computeQuote({
    ...base,
    signals: { phoneVerified: true, isNewCustomer: true, successfulOrders: 0 },
  });
  assert.equal(verified.phoneVerified, true);
  // core's contact factor: verified −10, unverified +10 — 20 points apart.
  assert.ok(verified.rto.score < unverified.rto.score);
});
