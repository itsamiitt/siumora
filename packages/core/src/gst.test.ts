import assert from "node:assert/strict";
import { test } from "node:test";

import { extractGst, isInterState } from "./gst.ts";

test("extracts tax out of an inclusive price rather than adding it on top", () => {
  // ₹1,180 inclusive at 18% is ₹1,000 taxable + ₹180 tax.
  const breakup = extractGst(118000, 18, { interState: false });
  assert.equal(breakup.taxableValue, 100000);
  assert.equal(breakup.totalTax, 18000);
  assert.equal(breakup.total, 118000);
});

test("splits intra-state tax into CGST and SGST", () => {
  const breakup = extractGst(118000, 18, { interState: false });
  assert.equal(breakup.cgst, 9000);
  assert.equal(breakup.sgst, 9000);
  assert.equal(breakup.igst, 0);
});

test("puts the whole tax into IGST on inter-state sales", () => {
  const breakup = extractGst(118000, 18, { interState: true });
  assert.equal(breakup.igst, 18000);
  assert.equal(breakup.cgst, 0);
  assert.equal(breakup.sgst, 0);
});

test("components always re-add to the exact inclusive total", () => {
  // An odd paise remainder must not vanish in the CGST/SGST split.
  for (const amount of [100001, 133337, 99999, 1, 250505]) {
    for (const slab of [5, 18, 40] as const) {
      const b = extractGst(amount, slab, { interState: false });
      assert.equal(b.taxableValue + b.cgst + b.sgst + b.igst, amount);
      assert.equal(b.cgst + b.sgst + b.igst, b.totalTax);
    }
  }
});

test("passes the amount through untaxed on the zero slab", () => {
  const breakup = extractGst(50000, 0, { interState: false });
  assert.equal(breakup.taxableValue, 50000);
  assert.equal(breakup.totalTax, 0);
});

test("treats only Maharashtra as intra-state", () => {
  assert.equal(isInterState("27"), false);
  assert.equal(isInterState("29"), true);
});
