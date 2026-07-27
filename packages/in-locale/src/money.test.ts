import assert from "node:assert/strict";
import { test } from "node:test";

import {
  discountPercent,
  formatIndianNumber,
  formatPaise,
  noCostEmiPerMonth,
} from "./money.ts";

test("formats paise with Indian digit grouping", () => {
  assert.equal(formatPaise(124900), "₹1,249");
  assert.equal(formatPaise(10000000), "₹1,00,000");
  assert.equal(formatPaise(100000000), "₹10,00,000");
});

test("omits paise by default and shows them on request", () => {
  assert.equal(formatPaise(124950), "₹1,250");
  assert.equal(formatPaise(124950, { showPaise: true }), "₹1,249.50");
});

test("formats bare numbers without a currency symbol", () => {
  assert.equal(formatIndianNumber(100000), "1,00,000");
});

test("floors the discount rather than rounding up", () => {
  // 16.7% off must not be advertised as 17%.
  assert.equal(discountPercent(300000, 250000), 16);
  assert.equal(discountPercent(200000, 100000), 50);
});

test("reports no discount when selling price is not below MRP", () => {
  assert.equal(discountPercent(100000, 100000), 0);
  assert.equal(discountPercent(100000, 120000), 0);
  assert.equal(discountPercent(0, 100000), 0);
});

test("rounds EMI up so the instalments never undershoot the total", () => {
  assert.equal(noCostEmiPerMonth(1000000, 3), 333334);
  assert.equal(noCostEmiPerMonth(1200000, 12), 100000);
});
