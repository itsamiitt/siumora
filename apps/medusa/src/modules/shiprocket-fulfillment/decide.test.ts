import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  ndrReasonFrom,
  parseShiprocketWebhook,
  parseSignedCourierWebhook,
  shipmentFor,
  trackingUrl,
  verifyCourierSignature,
  verifyShiprocketToken,
  type BookableOrder,
} from "./decide.ts";

const ORDER: BookableOrder = {
  number: "SIU-00042",
  placedAt: new Date("2026-10-25T08:00:00.000Z"),
  paymentMethod: "cod",
  address: {
    first_name: "Asha",
    last_name: "Menon",
    phone: "9876543210",
    address_1: "Flat 3B, Sunrise Apartments",
    address_2: "Linking Road, Near the post office",
    city: "Mumbai",
    province: "27",
    postal_code: "400001",
  },
  lines: [{ title: "Petal Studs", sku: "SIU-PS-GLD", quantity: 2, unitPricePaise: 199000, hsn: "7113" }],
};

// ── Booking ────────────────────────────────────────────────────────────────

test("an order books with the state's name, rupee prices and COD as COD", () => {
  const input = shipmentFor(ORDER, { pickupLocation: "Primary" });
  assert.ok(!("error" in input));
  if ("error" in input) return;
  assert.equal(input.orderNumber, "SIU-00042");
  assert.equal(input.orderDate, "2026-10-25");
  assert.equal(input.address.stateName, "Maharashtra");
  assert.equal(input.address.name, "Asha Menon");
  assert.equal(input.address.line1, "Flat 3B, Sunrise Apartments, Linking Road, Near the post office");
  assert.equal(input.items[0]!.sellingPrice, 1990);
  assert.equal(input.subTotal, 3980);
  assert.equal(input.paymentMethod, "COD");
});

test("a prepaid order books as Prepaid", () => {
  const input = shipmentFor({ ...ORDER, paymentMethod: "upi" }, { pickupLocation: "Primary" });
  assert.ok(!("error" in input) && input.paymentMethod === "Prepaid");
});

test("what a courier cannot carry is refused, not booked", () => {
  assert.deepEqual(shipmentFor({ ...ORDER, address: { ...ORDER.address, province: "99" } }, { pickupLocation: "P" }), {
    error: "unknown state code 99",
  });
  assert.deepEqual(shipmentFor({ ...ORDER, lines: [] }, { pickupLocation: "P" }), { error: "nothing to ship" });
  assert.deepEqual(shipmentFor({ ...ORDER, address: { ...ORDER.address, phone: null } }, { pickupLocation: "P" }), {
    error: "the delivery address has no phone",
  });
});

test("tracking links go to the AWB's page", () => {
  assert.equal(trackingUrl("SR123"), "https://shiprocket.co/tracking/SR123");
});

// ── Shiprocket pushes ──────────────────────────────────────────────────────

test("the delivery journey maps onto the status machine", () => {
  const at = (current_status: string) =>
    parseShiprocketWebhook({ awb: "SR1", order_id: "SIU-00042", current_status });
  assert.deepEqual(at("PICKED UP"), { kind: "status", orderNumber: "SIU-00042", awb: "SR1", status: "shipped" });
  assert.equal((at("IN TRANSIT") as { status: string }).status, "shipped");
  assert.equal((at("Out For Delivery") as { status: string }).status, "out_for_delivery");
  assert.equal((at("DELIVERED") as { status: string }).status, "delivered");
  assert.equal((at("RTO INITIATED") as { status: string }).status, "rto");
  assert.equal((at("RTO DELIVERED") as { status: string }).status, "rto");
});

test("an undelivered push is an NDR with the reason read from the courier's words", () => {
  assert.deepEqual(
    parseShiprocketWebhook({ awb: "SR1", current_status: "UNDELIVERED", reason: "Customer refused delivery" }),
    { kind: "status", awb: "SR1", status: "ndr", ndrReason: "customer_refused" },
  );
});

test("steps that are not the delivery journey are ignored", () => {
  assert.equal(parseShiprocketWebhook({ awb: "SR1", current_status: "PICKUP SCHEDULED" }).kind, "ignored");
  assert.equal(parseShiprocketWebhook({ current_status: "DELIVERED" }).kind, "ignored");
  assert.equal(parseShiprocketWebhook(null).kind, "ignored");
});

test("a channel order id that is not ours is not trusted as an order number", () => {
  const event = parseShiprocketWebhook({ awb: "SR1", order_id: "12345", current_status: "DELIVERED" });
  assert.deepEqual(event, { kind: "status", awb: "SR1", status: "delivered" });
});

test("NDR reasons read from free text, unavailable when unclear", () => {
  assert.equal(ndrReasonFrom("Address incomplete, landmark missing"), "address_incomplete");
  assert.equal(ndrReasonFrom("Phone switched off"), "phone_unreachable");
  assert.equal(ndrReasonFrom("Office closed"), "premises_closed");
  assert.equal(ndrReasonFrom("Cash not ready"), "payment_not_ready");
  assert.equal(ndrReasonFrom("Some other thing"), "customer_unavailable");
  assert.equal(ndrReasonFrom(undefined), "customer_unavailable");
});

// ── The signed format (parity: "lets a signed courier webhook move an order") ─

test("the signed format names the order and a status from the machine", () => {
  assert.deepEqual(
    parseSignedCourierWebhook({ order_number: "SIU-00042", status: "ndr", ndr_reason: "premises_closed" }),
    { kind: "status", orderNumber: "SIU-00042", status: "ndr", ndrReason: "premises_closed" },
  );
  assert.equal(parseSignedCourierWebhook({ order_number: "SIU-1", status: "teleported" }).kind, "ignored");
});

// ── Authentication ─────────────────────────────────────────────────────────

test("the Shiprocket token must match, and an unset token refuses", () => {
  assert.equal(verifyShiprocketToken("tok", "tok"), true);
  assert.equal(verifyShiprocketToken("guess", "tok"), false);
  assert.equal(verifyShiprocketToken(undefined, "tok"), false);
  assert.equal(verifyShiprocketToken("tok", undefined), false);
});

test("the signed format verifies its HMAC and refuses without a secret", () => {
  const body = '{"order_number":"SIU-1","status":"shipped"}';
  const signature = createHmac("sha256", "courier").update(body).digest("hex");
  assert.equal(verifyCourierSignature(body, signature, "courier"), true);
  assert.equal(verifyCourierSignature(body, signature, "other"), false);
  assert.equal(verifyCourierSignature(body, signature, undefined), false);
});
