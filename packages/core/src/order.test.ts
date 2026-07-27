import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canTransition,
  initialStatus,
  isRevenueRecognised,
  isTerminal,
  transition,
  type OrderStatus,
} from "./order.ts";

test("a prepaid order starts awaiting payment", () => {
  assert.equal(
    initialStatus("upi", { requiresCodConfirmation: false }),
    "pending_payment",
  );
});

test("a COD order needing verification does not enter fulfilment", () => {
  // Picking and packing before the customer confirms manufactures the RTO the
  // gating exists to prevent.
  assert.equal(
    initialStatus("cod", { requiresCodConfirmation: true }),
    "awaiting_cod_confirmation",
  );
});

test("a low-risk COD order is confirmed straight away", () => {
  assert.equal(
    initialStatus("cod", { requiresCodConfirmation: false }),
    "confirmed",
  );
});

test("walks the happy path to delivered", () => {
  let status: OrderStatus = "pending_payment";
  for (const next of [
    "confirmed",
    "processing",
    "shipped",
    "out_for_delivery",
    "delivered",
  ] as const) {
    status = transition(status, next);
  }
  assert.equal(status, "delivered");
});

test("a failed attempt goes to NDR and can recover", () => {
  // Most failures are a missed phone call, so NDR must be able to return to
  // delivery rather than dropping straight to a return.
  assert.ok(canTransition("out_for_delivery", "ndr"));
  assert.ok(canTransition("ndr", "out_for_delivery"));
  assert.ok(canTransition("ndr", "rto"));
});

test("refuses illegal transitions", () => {
  assert.throws(() => transition("pending_payment", "delivered"));
  assert.throws(() => transition("cancelled", "confirmed"));
  assert.throws(() => transition("delivered", "shipped"));
  assert.throws(() => transition("rto", "delivered"));
});

test("terminal states never move again", () => {
  for (const status of ["rto", "cancelled", "returned"] as const) {
    assert.equal(isTerminal(status), true);
  }
  assert.equal(isTerminal("shipped"), false);
});

test("only a delivered order counts as revenue", () => {
  // A COD parcel in transit is not money; treating it as revenue is how RTO
  // silently inflates the books.
  assert.equal(isRevenueRecognised("delivered"), true);
  for (const status of ["shipped", "confirmed", "rto", "ndr"] as const) {
    assert.equal(isRevenueRecognised(status), false);
  }
});

test("a delivered order can still be returned", () => {
  assert.equal(transition("delivered", "returned"), "returned");
});
