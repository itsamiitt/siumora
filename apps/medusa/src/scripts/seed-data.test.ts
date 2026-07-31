import { test } from "node:test";
import assert from "node:assert/strict";

import { CATALOG, COLLECTIONS, paiseToInrMajor } from "./seed-data.ts";

// The conversion site: paise → Medusa's INR major units, exact or refused.

test("paiseToInrMajor divides whole-rupee paise exactly", () => {
  assert.equal(paiseToInrMajor(199000), 1990);
  assert.equal(paiseToInrMajor(0), 0);
  assert.equal(paiseToInrMajor(100), 1);
});

test("paiseToInrMajor refuses sub-rupee amounts instead of emitting floats", () => {
  assert.throws(() => paiseToInrMajor(199050), /sub-rupee/);
  assert.throws(() => paiseToInrMajor(1), /sub-rupee/);
});

test("paiseToInrMajor refuses non-integer and negative paise", () => {
  assert.throws(() => paiseToInrMajor(1990.5), /non-negative integer/);
  assert.throws(() => paiseToInrMajor(-100), /non-negative integer/);
  assert.throws(() => paiseToInrMajor(Number.NaN), /non-negative integer/);
});

// The ported catalog: same shape and money rules as packages/db/src/seed.ts.

test("catalog is the canonical four products with seven variants", () => {
  assert.equal(CATALOG.length, 4);
  assert.equal(
    CATALOG.reduce((n, p) => n + p.variants.length, 0),
    7,
  );
  assert.equal(COLLECTIONS.length, 3);
});

test("every SKU is unique", () => {
  const skus = CATALOG.flatMap((p) => p.variants.map((v) => v.sku));
  assert.equal(new Set(skus).size, skus.length);
});

test("every price is integer whole-rupee paise, and MRP is never below it", () => {
  for (const product of CATALOG) {
    for (const variant of product.variants) {
      // Throws on floats or sub-rupee amounts — the seed would refuse them.
      paiseToInrMajor(variant.price);
      paiseToInrMajor(variant.mrp);
      assert.ok(
        variant.mrp >= variant.price,
        `${variant.sku}: mrp ${variant.mrp} < price ${variant.price}`,
      );
      assert.ok(Number.isSafeInteger(variant.inventory) && variant.inventory >= 0);
    }
  }
});

test("collection membership only references collections that exist", () => {
  const known = new Set<string>(COLLECTIONS.map((c) => c.handle));
  for (const product of CATALOG) {
    assert.ok(product.collections.length > 0, `${product.handle} has no collection`);
    for (const handle of product.collections) {
      assert.ok(known.has(handle), `${product.handle} references unknown "${handle}"`);
    }
  }
});

test("variant titles are unique per product — they double as option values", () => {
  for (const product of CATALOG) {
    const titles = product.variants.map((v) => v.title);
    assert.equal(new Set(titles).size, titles.length, product.handle);
  }
});
