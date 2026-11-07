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
