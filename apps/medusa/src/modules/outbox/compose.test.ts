import { test } from "node:test";
import assert from "node:assert/strict";

import {
  conversionEventFor,
  itemsPhrase,
  messageFor,
  purchasePayload,
  reminderDecision,
  type OrderFacts,
} from "./compose.ts";

const ORDER: OrderFacts = {
  id: "order_1",
  number: "SIU-00042",
  status: "confirmed",
  name: "Asha Menon",
  phone: "9876543210",
  totalPaise: 398000,
  customerId: "cus_1",
};

test("a confirmed order is told its total, by first name, once per status", () => {
  assert.deepEqual(messageFor(ORDER), {
    eventKey: "order_1:confirmed",
    templateKey: "order_confirmed",
    recipient: "9876543210",
    variables: { name: "Asha", orderNumber: "SIU-00042", total: "INR 3,980.00" },
    orderId: "order_1",
    customerId: "cus_1",
  });
});

test("shipped carries the real courier and AWB, or honest placeholders", () => {
  const booked = messageFor({ ...ORDER, status: "shipped", courier: "Delhivery", awb: "SR123" })!;
  assert.equal(booked.templateKey, "order_shipped");
  assert.equal(booked.variables.courier, "Delhivery");
  assert.equal(booked.variables.trackingId, "SR123");
  const unbooked = messageFor({ ...ORDER, status: "shipped" })!;
  assert.equal(unbooked.variables.courier, "our courier partner");
  assert.equal(unbooked.variables.trackingId, "SIU-00042");
});

test("a failed delivery explains itself in the customer's words", () => {
  const failed = messageFor({ ...ORDER, status: "ndr", ndrReason: "premises_closed" })!;
  assert.equal(failed.templateKey, "delivery_failed");
  assert.equal(typeof failed.variables.reason, "string");
  assert.notEqual(failed.variables.reason, "premises_closed");
});

test("statuses with nothing to say, and orders with no phone, send nothing", () => {
  assert.equal(messageFor({ ...ORDER, status: "processing" }), undefined);
  assert.equal(messageFor({ ...ORDER, phone: undefined }), undefined);
});

test("prepaid counts at confirmation; COD only once delivered", () => {
  assert.equal(conversionEventFor("upi", "confirmed"), "purchase");
  assert.equal(conversionEventFor("upi", "delivered"), undefined);
  assert.equal(conversionEventFor("cod", "confirmed"), undefined, "a COD order is not revenue until collected");
  assert.equal(conversionEventFor("cod", "delivered"), "cod_delivered");
});

test("the purchase payload is in rupees and keyed by the checkout's event id", () => {
  const payload = purchasePayload({
    eventId: "ev_1",
    orderNumber: "SIU-00042",
    totalPaise: 398000,
    taxPaise: 18952,
    shippingPaise: 0,
    lines: [{ sku: "SIU-PS-GLD", title: "Petal Studs", variantTitle: "Gold", unitPricePaise: 199000, quantity: 2 }],
  });
  assert.equal(payload.event_id, "ev_1");
  assert.equal(payload.value, 3980);
  assert.equal(payload.tax, 189.52);
  assert.deepEqual(payload.items[0], {
    item_id: "SIU-PS-GLD",
    item_name: "Petal Studs",
    price: 1990,
    quantity: 2,
    item_variant: "Gold",
    item_brand: "Siumora",
  });
});

test("a cart reminder waits while the shopper is active, then sends once it has gone quiet", () => {
  const consentedAt = new Date("2026-10-26T10:00:00Z");
  const cart = {
    completedAt: null,
    updatedAt: "2026-10-26T10:20:00Z",
    items: [{ title: "Petal Studs", quantity: 1 }, { title: "Moon Hoops", quantity: 2 }],
  };
  const at = (iso: string) => reminderDecision(cart, { consentedAt, now: new Date(iso), delayMinutes: 60 });
  assert.deepEqual(at("2026-10-26T11:00:00Z"), { kind: "wait" });
  assert.deepEqual(at("2026-10-26T11:21:00Z"), { kind: "send", items: "Petal Studs and 2 more pieces" });
  assert.deepEqual(at("2026-10-30T11:21:00Z"), { kind: "skip", reason: "too late to remind" });
});

test("a checked-out, emptied or missing cart is never reminded", () => {
  const input = { consentedAt: new Date("2026-10-26T10:00:00Z"), now: new Date("2026-10-26T12:00:00Z"), delayMinutes: 60 };
  const base = { completedAt: null, updatedAt: "2026-10-26T10:00:00Z", items: [{ title: "Petal Studs", quantity: 1 }] };
  assert.equal(reminderDecision({ ...base, completedAt: "2026-10-26T10:30:00Z" }, input).kind, "skip");
  assert.equal(reminderDecision({ ...base, items: [] }, input).kind, "skip");
  assert.equal(reminderDecision(undefined, input).kind, "skip");
  assert.equal(itemsPhrase([{ title: "Petal Studs", quantity: 2 }]), "2 × Petal Studs");
});
