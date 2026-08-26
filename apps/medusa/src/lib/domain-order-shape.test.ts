import { test } from "node:test";
import assert from "node:assert/strict";

import {
  toCartLines,
  toDomainOrder,
  toShippingAddress,
  type OrderWire,
} from "./domain-order-shape.ts";

// The shared order assembly every ops desk reads — pinned against the
// Fastify admin route's toDomainOrder semantics and the transport's address
// write (stateCode rides province, pincode rides postal_code).

const WIRE: OrderWire = {
  id: "order_1",
  status: "completed",
  created_at: "2026-08-20T10:00:00.000Z",
  shipping_total: 0,
  shipping_address: {
    first_name: "Aamya",
    last_name: "S",
    phone: "9000000001",
    address_1: "1 Marine Drive",
    city: "Mumbai",
    province: "27",
    postal_code: "400001",
  },
  items: [
    {
      id: "item_1",
      title: "Petal Studs",
      product_title: "Petal Studs",
      product_handle: "petal-studs",
      variant_id: "variant_1",
      variant_sku: "PS-G",
      variant_title: "Gold",
      thumbnail: "/catalog/petal-studs.svg",
      quantity: 2,
      unit_price: 1990,
      variant: {
        id: "variant_1",
        metadata: { mrp_paise: 249000, price_paise: 199000 },
        product: { metadata: { hsn: "7113", gst_slab: 5, pierced_jewellery: true } },
      },
    },
  ],
};

test("the address reverses the transport's write exactly", () => {
  const address = toShippingAddress(WIRE.shipping_address);
  assert.deepEqual(address, {
    name: "Aamya S",
    phone: "9000000001",
    line1: "1 Marine Drive",
    city: "Mumbai",
    stateCode: "27",
    pincode: "400001",
  });
});

test("lines carry integer paise from the metadata channel", () => {
  const [line] = toCartLines(WIRE);
  assert.equal(line!.mrp, 249000);
  assert.equal(line!.unitPrice, 199000);
  assert.equal(line!.quantity, 2);
  assert.equal(line!.gstSlab, 5);
  assert.equal(line!.hsn, "7113");
  assert.equal(line!.piercedJewellery, true);
});

test("the status row is the truth once it exists", () => {
  const order = toDomainOrder(WIRE, {
    orderNumber: "SIU-00042",
    statusRow: { status: "ndr", ndr_reason: "customer_unavailable" },
    ndrAttempts: 2,
    invoice: { invoice_number: "SIU/2026-27/000007", buyer_gstin: null },
  });
  assert.equal(order.number, "SIU-00042");
  assert.equal(order.status, "ndr");
  assert.equal(order.ndrReason, "customer_unavailable");
  assert.equal(order.deliveryAttempts, 2);
  assert.equal(order.invoiceNumber, "SIU/2026-27/000007");
  // Maharashtra to Maharashtra: intra-state.
  assert.equal(order.interState, false);
  // 2 × ₹1,990 with free shipping — integer paise all the way down.
  assert.equal(order.totals.total, 398000);
});

test("no status row: confirmed-unless-cancelled, same as every fresh order", () => {
  const fresh = toDomainOrder(WIRE, { orderNumber: "SIU-00001", ndrAttempts: 0 });
  assert.equal(fresh.status, "confirmed");
  assert.equal(fresh.invoiceNumber, undefined);

  const cancelled = toDomainOrder(
    { ...WIRE, status: "canceled" },
    { orderNumber: "SIU-00002", ndrAttempts: 0 },
  );
  assert.equal(cancelled.status, "cancelled");
});

test("a non-Maharashtra destination is inter-state and taxed as one", () => {
  const order = toDomainOrder(
    {
      ...WIRE,
      shipping_address: { ...WIRE.shipping_address, province: "07" },
    },
    { orderNumber: "SIU-00003", ndrAttempts: 0 },
  );
  assert.equal(order.interState, true);
  assert.equal(order.totals.gst.igst > 0, true);
  assert.equal(order.totals.gst.cgst, 0);
});
