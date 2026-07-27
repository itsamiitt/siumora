import assert from "node:assert/strict";
import { test } from "node:test";

import {
  amountToFreeShipping,
  calculateTotals,
  principalSlab,
  shippingFor,
  type CartLine,
} from "./cart.ts";

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    variantId: "v1",
    sku: "SIU-PS-GLD",
    productHandle: "petal-studs",
    title: "Petal Studs",
    variantTitle: "Gold",
    imageUrl: "/catalog/petal-studs.svg",
    mrp: 249000,
    unitPrice: 199000,
    quantity: 1,
    gstSlab: 5,
    hsn: "7113",
    piercedJewellery: false,
    ...overrides,
  };
}

test("sums MRP, subtotal, savings and item count", () => {
  const totals = calculateTotals([line({ quantity: 2 })], { interState: false });
  assert.equal(totals.mrpTotal, 498000);
  assert.equal(totals.subtotal, 398000);
  assert.equal(totals.savings, 100000);
  assert.equal(totals.itemCount, 2);
});

test("keeps tax inside the total rather than adding it on top", () => {
  const totals = calculateTotals([line()], { interState: false });
  assert.equal(totals.total, 199000);
  assert.equal(totals.gst.taxableValue + totals.gst.totalTax, totals.total);
});

test("adds shipping and COD fee into the total", () => {
  const totals = calculateTotals([line()], {
    interState: false,
    shipping: 7900,
    codFee: 4900,
  });
  assert.equal(totals.total, 199000 + 7900 + 4900);
  assert.equal(totals.gst.taxableValue + totals.gst.totalTax, totals.total);
});

test("groups mixed slabs instead of blending them into one rate", () => {
  const lines = [
    line({ variantId: "a", gstSlab: 5, unitPrice: 100000, mrp: 100000 }),
    line({ variantId: "b", gstSlab: 18, unitPrice: 100000, mrp: 100000 }),
  ];
  const totals = calculateTotals(lines, { interState: false });

  // 5% on ₹1,000 inclusive → ₹47.62 tax; 18% on ₹1,000 → ₹152.54.
  // A blended 11.5% would give ₹206 and misstate both slabs on GSTR-1.
  assert.equal(totals.gst.totalTax, 4762 + 15254);
  assert.equal(totals.gst.taxableValue + totals.gst.totalTax, totals.total);
});

test("taxes shipping at the principal supply's slab", () => {
  const lines = [
    line({ variantId: "a", gstSlab: 5, unitPrice: 50000, mrp: 50000 }),
    line({ variantId: "b", gstSlab: 18, unitPrice: 300000, mrp: 300000 }),
  ];
  // The 18% line is the higher value, so it is the principal supply.
  assert.equal(principalSlab(lines), 18);

  const totals = calculateTotals(lines, { interState: false, shipping: 7900 });
  assert.equal(totals.gst.taxableValue + totals.gst.totalTax, totals.total);
});

test("routes tax to IGST on inter-state orders", () => {
  const totals = calculateTotals([line()], { interState: true });
  assert.equal(totals.gst.cgst, 0);
  assert.equal(totals.gst.sgst, 0);
  assert.equal(totals.gst.igst, totals.gst.totalTax);
});

test("handles an empty cart without dividing by zero", () => {
  const totals = calculateTotals([], { interState: false });
  assert.equal(totals.total, 0);
  assert.equal(totals.gst.totalTax, 0);
  assert.equal(totals.itemCount, 0);
});

test("gives free shipping at and above the threshold", () => {
  assert.equal(shippingFor(99900), 0);
  assert.equal(shippingFor(100000), 0);
  assert.equal(shippingFor(99899), 7900);
});

test("reports how far the cart is from free shipping", () => {
  assert.equal(amountToFreeShipping(50000), 49900);
  assert.equal(amountToFreeShipping(99900), 0);
  assert.equal(amountToFreeShipping(150000), 0);
});
