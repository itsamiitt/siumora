import { test } from "node:test";
import assert from "node:assert/strict";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { GST_SLABS } from "@siumora/core";

import {
  PUBLISHABLE_GST_SLABS,
  missingPublishFields,
  publishRefusal,
} from "./product-publish-guard.ts";

const complete = { id: "prod_1", title: "Petal Studs", status: "published", metadata: { hsn: "7113", gst_slab: 5 } };

test("the slab mirror matches core", () => {
  assert.deepEqual([...PUBLISHABLE_GST_SLABS], [...GST_SLABS]);
});

test("a complete published product passes", () => {
  assert.deepEqual(missingPublishFields(complete), []);
  assert.equal(publishRefusal([complete]), null);
});

test("drafts may be incomplete — that is how a product gets filled in", () => {
  assert.deepEqual(missingPublishFields({ ...complete, status: "draft", metadata: {} }), []);
  assert.deepEqual(missingPublishFields({ ...complete, status: "proposed", metadata: null }), []);
});

test("publishing without a slab or HSN is refused, naming the product and the fields", () => {
  assert.deepEqual(missingPublishFields({ ...complete, metadata: { hsn: "7113" } }), ["GST slab"]);
  assert.deepEqual(missingPublishFields({ ...complete, metadata: { gst_slab: 5 } }), ["HSN code"]);
  assert.deepEqual(missingPublishFields({ ...complete, metadata: null }), ["HSN code", "GST slab"]);
  const refusal = publishRefusal([complete, { ...complete, title: "No Slab", metadata: { hsn: "7113" } }]);
  assert.match(refusal ?? "", /"No Slab" needs GST slab/);
  assert.doesNotMatch(refusal ?? "", /Petal Studs/);
});

test("a slab off the list, a string slab, or a malformed HSN is refused", () => {
  assert.deepEqual(missingPublishFields({ ...complete, metadata: { hsn: "7113", gst_slab: 12 } }), ["GST slab"]);
  assert.deepEqual(missingPublishFields({ ...complete, metadata: { hsn: "7113", gst_slab: "5" } }), ["GST slab"]);
  assert.deepEqual(missingPublishFields({ ...complete, metadata: { hsn: "71", gst_slab: 5 } }), ["HSN code"]);
  assert.deepEqual(missingPublishFields({ ...complete, metadata: { hsn: 7113, gst_slab: 5 } }), ["HSN code"]);
});

const priced = {
  ...complete,
  variants: [{ id: "v1", prices: [{ amount: 1990, currency_code: "inr" }] }],
  sales_channels: [{ id: "sc_store" }],
};
const storefront = new Set(["sc_store"]);

test("a priced product in the storefront channel passes", () => {
  assert.deepEqual(missingPublishFields(priced, storefront), []);
});

test("a published variant with no INR price is refused — the storefront would hide it silently", () => {
  const usdOnly = { ...priced, variants: [{ id: "v1", prices: [{ amount: 20, currency_code: "usd" }] }] };
  assert.deepEqual(missingPublishFields(usdOnly, storefront), ["an INR price on every variant"]);
  const oneUnpriced = { ...priced, variants: [...priced.variants, { id: "v2", prices: [] }] };
  assert.deepEqual(missingPublishFields(oneUnpriced, storefront), ["an INR price on every variant"]);
  const zero = { ...priced, variants: [{ id: "v1", prices: [{ amount: 0, currency_code: "INR" }] }] };
  assert.deepEqual(missingPublishFields(zero, storefront), ["an INR price on every variant"]);
  assert.deepEqual(missingPublishFields({ ...priced, variants: [] }, storefront), ["at least one variant"]);
});

test("a product outside every storefront channel is refused; no key list skips the check", () => {
  const elsewhere = { ...priced, sales_channels: [{ id: "sc_pos" }] };
  assert.deepEqual(missingPublishFields(elsewhere, storefront), ["the storefront sales channel"]);
  assert.deepEqual(missingPublishFields({ ...priced, sales_channels: null }, storefront), ["the storefront sales channel"]);
  assert.deepEqual(missingPublishFields(elsewhere), []);
  assert.match(publishRefusal([elsewhere], storefront) ?? "", /"Petal Studs" needs the storefront sales channel/);
});

test("drafts skip the storefront checks too", () => {
  assert.deepEqual(missingPublishFields({ ...priced, status: "draft", variants: [], sales_channels: [] }, storefront), []);
});
