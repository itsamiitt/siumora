import { test } from "node:test";
import assert from "node:assert/strict";

import {
  missingFields,
  parseProductFields,
  parseVariantFields,
  paiseToRupees,
  rupeesToPaise,
} from "./india-fields.ts";

// The M4 "NOT NULL" bar, enforced at the widget: statutory fields validate
// before save, and a product missing any of them banners as incomplete.

test("HSN must be 4 to 8 digits", () => {
  assert.ok(parseProductFields({ hsn: "7113", gstSlab: "5" }).ok);
  assert.ok(parseProductFields({ hsn: "71131190", gstSlab: "5" }).ok);
  assert.ok(!parseProductFields({ hsn: "711", gstSlab: "5" }).ok);
  assert.ok(!parseProductFields({ hsn: "7113A", gstSlab: "5" }).ok);
});

test("the slab must be one of core's GST_SLABS", () => {
  for (const slab of ["0", "5", "18", "40"]) {
    assert.ok(parseProductFields({ hsn: "7113", gstSlab: slab }).ok);
  }
  assert.ok(!parseProductFields({ hsn: "7113", gstSlab: "12" }).ok);
  assert.ok(!parseProductFields({ hsn: "7113", gstSlab: "" }).ok);
});

test("rupees to integer paise: commas and two decimals, nothing looser", () => {
  assert.equal(rupeesToPaise("1,990"), 199000);
  assert.equal(rupeesToPaise("1990.50"), 199050);
  assert.equal(rupeesToPaise("₹1990"), 199000);
  assert.equal(rupeesToPaise("1990.505"), undefined);
  assert.equal(rupeesToPaise("abc"), undefined);
});

test("paise render back without trailing .00 noise", () => {
  assert.equal(paiseToRupees(199000), "1990");
  assert.equal(paiseToRupees(199050), "1990.50");
});

test("MRP below the selling price is refused — that is a strike-through lie", () => {
  assert.ok(parseVariantFields({ mrp: "2490", price: "1990" }).ok);
  assert.ok(!parseVariantFields({ mrp: "1500", price: "1990" }).ok);
  assert.ok(!parseVariantFields({ mrp: "0", price: "0" }).ok);
});

test("the incomplete banner names what is missing", () => {
  assert.deepEqual(
    missingFields({ metadata: {}, variants: [{ metadata: {} }] }),
    ["HSN", "GST slab", "variant MRP/price paise"],
  );
  assert.deepEqual(
    missingFields({
      metadata: { hsn: "7113", gst_slab: 5 },
      variants: [{ metadata: { mrp_paise: 249000, price_paise: 199000 } }],
    }),
    [],
  );
});
