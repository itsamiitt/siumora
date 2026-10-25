import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FIELD_ORDER,
  analyticsItems,
  arrivalBy,
  deliveryErrors,
  firstInvalid,
  formatArrival,
  phoneError,
} from "./checkout-rules.ts";

const COMPLETE = {
  name: "Asha Menon",
  pincode: "400001",
  stateCode: "27",
  city: "Mumbai",
  line1: "Flat 3B, Sunrise Apartments",
};

test("a complete delivery address has no errors", () => {
  assert.deepEqual(deliveryErrors(COMPLETE), {});
});

test("each missing piece is named in the server's own words", () => {
  assert.deepEqual(deliveryErrors({ name: " ", pincode: "0123", stateCode: "", city: "", line1: "x" }), {
    pincode: "Enter a six-digit pincode.",
    stateCode: "Choose the state.",
    city: "Enter the city.",
    name: "Enter the name for delivery.",
    line1: "Add your flat, house or building.",
  });
});

test("only Indian mobile numbers are delivery phones", () => {
  assert.equal(phoneError("9812345678"), undefined);
  assert.equal(phoneError("5812345678"), "Enter a 10-digit mobile number.");
  assert.equal(phoneError("98123"), "Enter a 10-digit mobile number.");
});

test("focus goes to the first field on screen that is wrong", () => {
  assert.equal(firstInvalid({ line1: "x", pincode: "y" }), "pincode");
  assert.equal(firstInvalid({}), undefined);
  assert.equal(FIELD_ORDER[0], "phone");
});

test("a delivery window becomes the latest arrival date", () => {
  const now = new Date("2026-10-25T06:00:00.000Z");
  assert.equal(arrivalBy("2-3", now)?.toISOString(), "2026-10-28T06:00:00.000Z");
  assert.equal(arrivalBy("4–6", now)?.toISOString(), "2026-10-31T06:00:00.000Z");
  assert.equal(arrivalBy("—", now), undefined);
  assert.equal(arrivalBy("0", now), undefined);
});

test("the arrival date reads as a short Indian date", () => {
  assert.match(formatArrival(new Date("2026-10-30T06:00:00.000Z")), /Fri.*30.*Oct/);
});

test("analytics items carry the SKU and rupee prices, never an empty list for a full bag", () => {
  const items = analyticsItems([
    {
      variantId: "variant_1",
      sku: "SIU-PS-GLD",
      productHandle: "petal-studs",
      title: "Petal Studs",
      variantTitle: "Gold",
      imageUrl: "",
      mrp: 249000,
      unitPrice: 199000,
      quantity: 2,
      gstSlab: 5,
      hsn: "7113",
      piercedJewellery: true,
    },
  ]);
  assert.deepEqual(items, [
    {
      item_id: "SIU-PS-GLD",
      item_name: "Petal Studs",
      price: 1990,
      quantity: 2,
      item_variant: "Gold",
      item_brand: "Siumora",
    },
  ]);
});
