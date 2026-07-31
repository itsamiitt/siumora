import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ORDER_NUMBER_SQL,
  PLACED_STATUS,
  completionEnvelope,
  formatOrderNumber,
  isWellFormedAccessKey,
  linePaise,
  majorToPaise,
  siumoraOrderStatus,
  wireNumber,
  type IdentityRow,
} from "./identity.ts";
import {
  FREE_SHIPPING_THRESHOLD_PAISE,
  STANDARD_SHIPPING_PAISE,
} from "../../scripts/seed-data.ts";

// Dynamic on purpose: this app typechecks as CJS and core's static surface
// is ESM; a dynamic import is legal from both worlds. These pins are what
// make the copied constants and the held status honest — drift from core
// fails here, loudly.
const corePromise = import("@siumora/core");

// ── Pins against @siumora/core ────────────────────────────────

test("formatOrderNumber agrees with core's orderNumber, digit for digit", async () => {
  const core = await corePromise;
  for (const sequence of [1, 7, 42, 99, 100, 9999, 99999, 100000]) {
    assert.equal(formatOrderNumber(sequence), core.orderNumber(sequence));
  }
});

test("PLACED_STATUS is core's initialStatus for unheld COD", async () => {
  const core = await corePromise;
  assert.equal(
    PLACED_STATUS,
    core.initialStatus("cod", { requiresCodConfirmation: false }),
  );
});

test("the seed's shipping tiers are core's shipping tiers", async () => {
  const core = await corePromise;
  assert.equal(FREE_SHIPPING_THRESHOLD_PAISE, core.FREE_SHIPPING_THRESHOLD);
  assert.equal(STANDARD_SHIPPING_PAISE, core.STANDARD_SHIPPING);
});

test("formatOrderNumber matches the recorded contract regex", () => {
  assert.match(formatOrderNumber(1), /^SIU-\d{5}$/);
  assert.match(formatOrderNumber(99999), /^SIU-\d{5}$/);
});

test("the SQL twin encodes the same recipe: SIU-, lpad to 5", () => {
  // The authoritative formatting runs inside Postgres (one atomic statement
  // with the sequence draw). This pins the SQL to the JS mirror the tests
  // just proved against core: same prefix, same pad width.
  assert.ok(ORDER_NUMBER_SQL.includes("'SIU-'"));
  assert.ok(ORDER_NUMBER_SQL.includes("lpad"));
  assert.ok(ORDER_NUMBER_SQL.includes("::text, 5, '0'"));
  assert.ok(ORDER_NUMBER_SQL.includes("nextval('siumora_order_number_seq')"));
});

// ── Access-key semantics: the 400/404 fork ────────────────────

test("a real uuid is well-formed — it earns a 404 lookup, never a 400", () => {
  assert.equal(isWellFormedAccessKey(crypto.randomUUID()), true);
  assert.equal(isWellFormedAccessKey("A9C3B1E2-4F5D-4a6b-9c8d-112233445566"), true);
});

test("malformed keys are refused as 400 material", () => {
  for (const bad of [
    "not-a-uuid",
    "",
    "1234",
    "a9c3b1e2-4f5d-4a6b-9c8d-11223344556", // one hex short
    "a9c3b1e2-4f5d-4a6b-zc8d-112233445566", // z is not hex
    "a9c3b1e24f5d4a6b9c8d112233445566", // no dashes
  ]) {
    assert.equal(isWellFormedAccessKey(bad), false, bad);
  }
});

// ── Money: majors → paise, refusing floats ────────────────────

test("majorToPaise converts whole-paise amounts exactly", () => {
  assert.equal(majorToPaise(0), 0);
  assert.equal(majorToPaise(79), 7900);
  assert.equal(majorToPaise(1990), 199000);
  assert.equal(majorToPaise(19.9), 1990);
});

test("majorToPaise refuses an amount that is not integer paise", () => {
  assert.throws(() => majorToPaise(1.005), /does not convert/);
  assert.throws(() => majorToPaise(Number.NaN), /does not convert/);
  assert.throws(() => majorToPaise(Number.POSITIVE_INFINITY), /does not convert/);
});

test("linePaise prefers the lossless metadata channel", () => {
  const line = {
    quantity: 2,
    unit_price: 1990,
    variant: { metadata: { price_paise: 199000, mrp_paise: 249000 } },
  };
  assert.deepEqual(linePaise(line), { unitPrice: 199000, mrp: 249000 });
});

test("linePaise falls back to majors x 100, and prices MRP at selling when absent", () => {
  const line = { quantity: 1, unit_price: 1990, variant: { metadata: {} } };
  assert.deepEqual(linePaise(line), { unitPrice: 199000, mrp: 199000 });

  const bare = { quantity: 1, unit_price: 79 };
  assert.deepEqual(linePaise(bare), { unitPrice: 7900, mrp: 7900 });
});

test("linePaise ignores corrupt metadata rather than serving it", () => {
  const line = {
    quantity: 1,
    unit_price: 1990,
    variant: { metadata: { price_paise: 1990.5, mrp_paise: -1 } },
  };
  // Non-integer / negative metadata is not money; the majors fallback is.
  assert.deepEqual(linePaise(line), { unitPrice: 199000, mrp: 199000 });
});

// ── Status vocabulary ─────────────────────────────────────────

test("statuses map into the storefront's vocabulary", () => {
  assert.equal(siumoraOrderStatus("pending"), "confirmed");
  assert.equal(siumoraOrderStatus("completed"), "confirmed");
  assert.equal(siumoraOrderStatus("canceled"), "cancelled");
});

// ── The checkout envelope ─────────────────────────────────────

test("completionEnvelope carries exactly the recorded contract keys", () => {
  const identity: IdentityRow = {
    id: "sioid_x",
    order_id: "order_x",
    cart_id: "cart_x",
    order_number: "SIU-00042",
    access_key: "0b2a4e88-1111-4222-8333-444455556666",
    idempotency_key: null,
    created_at: new Date(),
  };
  const envelope = completionEnvelope(identity, "confirmed");
  assert.deepEqual(Object.keys(envelope).sort(), [
    "accessKey",
    "invoiceNumber",
    "ok",
    "orderNumber",
    "status",
  ]);
  assert.equal(envelope.ok, true);
  assert.match(envelope.orderNumber, /^SIU-\d{5}$/);
  assert.equal(envelope.invoiceNumber, null);
  assert.ok(envelope.accessKey.length >= 16);
});

test("wireNumber unwraps a BigNumber-shaped wire value and refuses garbage", () => {
  // query.graph money fields arrive as objects whose toJSON is the number.
  const bigNumberish = { toJSON: () => 79 };
  assert.equal(wireNumber(bigNumberish, "shipping_total"), 79);
  assert.equal(wireNumber(1990, "unit_price"), 1990);
  assert.equal(wireNumber(null, "shipping_total"), 0);
  assert.throws(() => wireNumber({ not: "a number" }, "x"), /not numeric/);
  assert.throws(() => wireNumber("79", "x"), /not numeric/);
});
