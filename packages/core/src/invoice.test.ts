import assert from "node:assert/strict";
import { test } from "node:test";

import type { CartLine } from "./cart.ts";
import {
  financialYear,
  hsnSummary,
  invoiceNumber,
  orderNumber,
  summariseInvoice,
} from "./invoice.ts";

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    variantId: "v1",
    sku: "SKU-1",
    productHandle: "petal-studs",
    title: "Petal Studs",
    variantTitle: "Gold",
    imageUrl: "/i.svg",
    mrp: 249000,
    unitPrice: 199000,
    quantity: 1,
    gstSlab: 5,
    hsn: "7113",
    piercedJewellery: false,
    ...overrides,
  };
}

test("financial year runs April to March, not January to December", () => {
  // April 2026 starts FY 2026-27.
  assert.equal(financialYear(new Date("2026-04-01T00:00:00Z")), "2026-27");
  assert.equal(financialYear(new Date("2026-12-31T00:00:00Z")), "2026-27");
  // January to March still belong to the year that began the previous April.
  assert.equal(financialYear(new Date("2027-01-01T00:00:00Z")), "2026-27");
  assert.equal(financialYear(new Date("2027-03-31T00:00:00Z")), "2026-27");
  // And 1 April flips it.
  assert.equal(financialYear(new Date("2027-04-01T00:00:00Z")), "2027-28");
});

test("handles the century boundary in the short year", () => {
  assert.equal(financialYear(new Date("2099-05-01T00:00:00Z")), "2099-00");
});

test("invoice numbers are zero-padded and carry the financial year", () => {
  const date = new Date("2026-07-27T00:00:00Z");
  assert.equal(invoiceNumber(1, date), "SIU/2026-27/000001");
  assert.equal(invoiceNumber(123, date), "SIU/2026-27/000123");
});

test("the same sequence in a different year is a different invoice", () => {
  // The series restarts each April, so the year must be part of the number.
  const a = invoiceNumber(1, new Date("2026-04-01T00:00:00Z"));
  const b = invoiceNumber(1, new Date("2027-04-01T00:00:00Z"));
  assert.notEqual(a, b);
});

test("rejects a non-positive sequence", () => {
  const date = new Date("2026-07-27T00:00:00Z");
  assert.throws(() => invoiceNumber(0, date), RangeError);
  assert.throws(() => invoiceNumber(-1, date), RangeError);
  assert.throws(() => invoiceNumber(1.5, date), RangeError);
});

test("order numbers are short and padded", () => {
  assert.equal(orderNumber(42), "SIU-00042");
});

test("groups the summary by HSN and slab", () => {
  const rows = hsnSummary(
    [
      line({ hsn: "7113", gstSlab: 5, unitPrice: 100000 }),
      line({ hsn: "7113", gstSlab: 5, unitPrice: 100000 }),
      line({ hsn: "7117", gstSlab: 18, unitPrice: 100000 }),
    ],
    { interState: false },
  );

  assert.equal(rows.length, 2);
  const first = rows.find((r) => r.hsn === "7113")!;
  assert.equal(first.total, 200000);
});

test("keeps the same HSN in different slabs apart", () => {
  // A shared HSN can legitimately sit in two slabs; collapsing them would
  // misreport both on the return.
  const rows = hsnSummary(
    [
      line({ hsn: "7113", gstSlab: 5, unitPrice: 100000 }),
      line({ hsn: "7113", gstSlab: 18, unitPrice: 100000 }),
    ],
    { interState: false },
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.slab), [5, 18]);
});

test("summary components re-add to the invoice total", () => {
  const lines = [
    line({ hsn: "7113", gstSlab: 5, unitPrice: 133337, quantity: 3 }),
    line({ hsn: "7117", gstSlab: 18, unitPrice: 99999, quantity: 2 }),
  ];

  const totals = summariseInvoice(hsnSummary(lines, { interState: false }));
  assert.equal(totals.taxableValue + totals.totalTax, totals.total);
  assert.equal(totals.cgst + totals.sgst + totals.igst, totals.totalTax);
});

test("routes tax to IGST on an inter-state invoice", () => {
  const totals = summariseInvoice(
    hsnSummary([line()], { interState: true }),
  );
  assert.equal(totals.cgst, 0);
  assert.equal(totals.sgst, 0);
  assert.equal(totals.igst, totals.totalTax);
});
