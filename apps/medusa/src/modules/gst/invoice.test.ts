import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INVOICE_NUMBER_SQL,
  assertInvoiceReconciles,
  computeInvoice,
  formatInvoiceNumber,
  invoiceCard,
  toInvoiceLines,
  type GstInvoiceRow,
} from "./invoice.ts";
import { completionEnvelope, type IdentityRow } from "../siumora-order/identity.ts";

// Dynamic on purpose: this app typechecks as CJS and core's static surface
// is ESM; a dynamic import is legal from both worlds. These pins are what
// make the mirrored number format honest — drift from core fails here,
// loudly.
const corePromise = import("@siumora/core");

// ── Pins against @siumora/core ────────────────────────────────

test("formatInvoiceNumber agrees with core's invoiceNumber, digit for digit", async () => {
  const core = await corePromise;
  for (const date of [
    new Date("2026-07-31T05:30:00Z"),
    new Date("2026-01-15T00:00:00Z"),
    new Date("2027-04-01T00:00:00Z"),
  ]) {
    for (const sequence of [1, 7, 42, 999, 123456, 999999]) {
      assert.equal(
        formatInvoiceNumber(sequence, core.financialYear(date)),
        core.invoiceNumber(sequence, date),
      );
    }
  }
});

test("the financial year turns on April 1, not January 1", async () => {
  // The series restarts each Indian financial year (April–March). A series
  // that reset on 1 January would only surface at the first annual return.
  const core = await corePromise;
  assert.equal(core.financialYear(new Date("2026-03-31T23:59:59Z")), "2025-26");
  assert.equal(core.financialYear(new Date("2026-04-01T00:00:00Z")), "2026-27");
  assert.equal(core.financialYear(new Date("2026-01-15T12:00:00Z")), "2025-26");
  assert.equal(core.financialYear(new Date("2026-12-31T23:59:59Z")), "2026-27");
});

test("formatInvoiceNumber matches the recorded contract regex", () => {
  assert.match(formatInvoiceNumber(1, "2026-27"), /^SIU\/\d{4}-\d{2}\/\d{6}$/);
  assert.match(formatInvoiceNumber(999999, "2026-27"), /^SIU\/\d{4}-\d{2}\/\d{6}$/);
  assert.equal(formatInvoiceNumber(123, "2026-27"), "SIU/2026-27/000123");
});

test("the SQL twin encodes the same recipe: SIU/, the FY, lpad to 6 — and no nextval", () => {
  // The authoritative formatting runs inside Postgres (one atomic statement
  // with the MAX+1 draw). This pins the SQL to the JS mirror the tests just
  // proved against core: same prefix, same pad width. And it pins what must
  // NOT be there: nextval — a Postgres sequence burns a value on rollback,
  // which a gapless statutory series cannot afford.
  assert.ok(INVOICE_NUMBER_SQL.includes("'SIU/'"));
  assert.ok(INVOICE_NUMBER_SQL.includes("lpad"));
  assert.ok(INVOICE_NUMBER_SQL.includes("::text, 6, '0'"));
  assert.ok(!INVOICE_NUMBER_SQL.includes("nextval"));
});

// ── Line mapping: strict where the order card is lenient ──────

const goldStuds = {
  quantity: 2,
  unit_price: 1990,
  variant_id: "variant_studs",
  variant_sku: "SIU-PS-GLD",
  variant_title: "Gold",
  product_title: "Petal Studs",
  product_handle: "petal-studs",
  thumbnail: "/catalog/petal-studs.svg",
  variant: {
    id: "variant_studs",
    metadata: { price_paise: 199000, mrp_paise: 249000 },
    product: { metadata: { gst_slab: 5, hsn: "7113", pierced_jewellery: true } },
  },
};

test("toInvoiceLines reads the lossless paise channel and the product's tax fields", () => {
  const [line] = toInvoiceLines([goldStuds]);
  assert.deepEqual(line, {
    variantId: "variant_studs",
    sku: "SIU-PS-GLD",
    productHandle: "petal-studs",
    title: "Petal Studs",
    variantTitle: "Gold",
    imageUrl: "/catalog/petal-studs.svg",
    mrp: 249000,
    unitPrice: 199000,
    quantity: 2,
    gstSlab: 5,
    hsn: "7113",
    piercedJewellery: true,
  });
});

test("toInvoiceLines refuses a line that cannot go on a statutory document", () => {
  const noSlab = {
    ...goldStuds,
    variant: { ...goldStuds.variant, product: { metadata: { hsn: "7113" } } },
  };
  assert.throws(() => toInvoiceLines([noSlab]), /invoice refused: .*gst_slab/);

  const badSlab = {
    ...goldStuds,
    variant: {
      ...goldStuds.variant,
      product: { metadata: { gst_slab: 12, hsn: "7113" } },
    },
  };
  assert.throws(() => toInvoiceLines([badSlab]), /invoice refused: .*gst_slab/);

  const noHsn = {
    ...goldStuds,
    variant: { ...goldStuds.variant, product: { metadata: { gst_slab: 5 } } },
  };
  assert.throws(() => toInvoiceLines([noHsn]), /invoice refused: .*HSN/);

  assert.throws(() => toInvoiceLines([]), /invoice refused: .*no lines/);
});

// ── The card: core's engine, plus the write-time assertion ────

test("computeInvoice produces core's rows and totals, and they re-add", async () => {
  const core = await corePromise;
  const lines = toInvoiceLines([goldStuds]);
  const { rows, totals } = computeInvoice(lines, { interState: false });

  // The same engine the Fastify invoices came from, over the same paise.
  const expectedRows = core.hsnSummary(lines, { interState: false });
  assert.deepEqual(rows, expectedRows);
  assert.deepEqual(totals, core.summariseInvoice(expectedRows));

  // 2 × ₹1,990 at 5% inclusive: the components re-add to the tag price.
  assert.equal(totals.total, 398000);
  assert.equal(totals.taxableValue + totals.cgst + totals.sgst + totals.igst, 398000);
  assert.equal(totals.igst, 0);
});

test("an inter-state supply puts the whole tax under IGST", () => {
  const { totals } = computeInvoice(toInvoiceLines([goldStuds]), {
    interState: true,
  });
  assert.equal(totals.cgst, 0);
  assert.equal(totals.sgst, 0);
  assert.equal(totals.igst, totals.totalTax);
  assert.equal(totals.total, 398000);
});

test("assertInvoiceReconciles refuses drift — a wrong statutory row is never written", async () => {
  const core = await corePromise;
  const lines = toInvoiceLines([goldStuds]);
  const rows = core.hsnSummary(lines, { interState: false });
  const totals = core.summariseInvoice(rows);
  const expected = { goodsTotal: 398000, interState: false };

  // The honest card passes.
  assert.doesNotThrow(() => assertInvoiceReconciles(rows, totals, expected));

  // One paisa of drift in a tax head: refused.
  assert.throws(
    () =>
      assertInvoiceReconciles(rows, { ...totals, cgst: totals.cgst + 1 }, expected),
    /invoice refused/,
  );
  // A total that disagrees with the order's own goods value: refused.
  assert.throws(
    () => assertInvoiceReconciles(rows, totals, { ...expected, goodsTotal: 398001 }),
    /invoice refused: invoice total/,
  );
  // Tax heads on the wrong side of the interstate split: refused.
  assert.throws(
    () => assertInvoiceReconciles(rows, totals, { ...expected, interState: true }),
    /invoice refused/,
  );
  // An invoice with nothing on it: refused.
  assert.throws(() => assertInvoiceReconciles([], totals, expected), /invoice refused/);
});

// ── Envelope shapes ───────────────────────────────────────────

const storedRow: GstInvoiceRow = {
  id: "gsinv_x",
  order_id: "order_x",
  financial_year: "2026-27",
  sequence: 1,
  invoice_number: "SIU/2026-27/000001",
  buyer_gstin: null,
  interstate: false,
  rows: [
    {
      hsn: "7113",
      slab: 5,
      taxableValue: 379048,
      cgst: 9476,
      sgst: 9476,
      igst: 0,
      total: 398000,
    },
  ],
  totals: {
    taxableValue: 379048,
    cgst: 9476,
    sgst: 9476,
    igst: 0,
    totalTax: 18952,
    total: 398000,
  },
  created_at: new Date(),
};

test("invoiceCard serves exactly the Fastify card shape: { rows, totals }", () => {
  const card = invoiceCard(storedRow);
  assert.deepEqual(Object.keys(card).sort(), ["rows", "totals"]);
  assert.deepEqual(Object.keys(card.totals).sort(), [
    "cgst",
    "igst",
    "sgst",
    "taxableValue",
    "total",
    "totalTax",
  ]);
  assert.deepEqual(Object.keys(card.rows[0]!).sort(), [
    "cgst",
    "hsn",
    "igst",
    "sgst",
    "slab",
    "taxableValue",
    "total",
  ]);
  // Straight off the stored row — the issued invoice, not a recomputation.
  assert.equal(card.totals.total, 398000);
});

test("the completion envelope keeps the recorded contract keys with a real invoiceNumber", () => {
  // The complete route spreads the identity envelope and overrides
  // invoiceNumber with the stored number — same keys, null flipped to real.
  const identity: IdentityRow = {
    id: "sioid_x",
    order_id: "order_x",
    cart_id: "cart_x",
    order_number: "SIU-00042",
    access_key: "0b2a4e88-1111-4222-8333-444455556666",
    idempotency_key: null,
    created_at: new Date(),
  };
  const envelope = {
    ...completionEnvelope(identity, "confirmed"),
    invoiceNumber: storedRow.invoice_number as string | null,
  };
  assert.deepEqual(Object.keys(envelope).sort(), [
    "accessKey",
    "invoiceNumber",
    "ok",
    "orderNumber",
    "status",
  ]);
  assert.match(envelope.invoiceNumber ?? "", /^SIU\/\d{4}-\d{2}\/\d{6}$/);
});
