import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RETURN_WINDOW_DAYS,
  canTransitionRma,
  daysSince,
  evaluateReturn,
  isFault,
  transitionRma,
  type ReturnEligibilityInput,
} from "./returns.ts";

const DELIVERED = new Date("2026-07-01T10:00:00Z");

function input(overrides: Partial<ReturnEligibilityInput> = {}): ReturnEligibilityInput {
  return {
    orderStatus: "delivered",
    deliveredAt: DELIVERED,
    now: new Date("2026-07-03T10:00:00Z"),
    reason: "changed_mind",
    isPiercedJewellery: false,
    paymentMethod: "upi",
    ...overrides,
  };
}

function daysLater(days: number): Date {
  return new Date(DELIVERED.getTime() + days * 86_400_000);
}

test("accepts a return inside the published window", () => {
  const result = evaluateReturn(input());
  assert.equal(result.eligible, true);
  assert.equal(result.autoApproved, true);
});

test("the window is inclusive of its last day", () => {
  // The page says 7 days. Day 7 has to work, or the page is lying.
  assert.equal(evaluateReturn(input({ now: daysLater(7) })).eligible, true);
  assert.equal(evaluateReturn(input({ now: daysLater(8) })).eligible, false);
});

test("explains a refusal in days the customer can check", () => {
  const result = evaluateReturn(input({ now: daysLater(10) }));
  assert.equal(result.eligible, false);
  assert.match(result.refusal ?? "", new RegExp(`${RETURN_WINDOW_DAYS} days`));
  assert.match(result.refusal ?? "", /10 days ago/);
});

test("refuses a return on an order that was never delivered", () => {
  for (const status of ["shipped", "confirmed", "rto"] as const) {
    assert.equal(evaluateReturn(input({ orderStatus: status })).eligible, false);
  }
});

test("damage must be reported within 48 hours", () => {
  assert.equal(
    evaluateReturn(input({ reason: "damaged", now: daysLater(1) })).eligible,
    true,
  );
  // Past two days it can no longer be attributed to transit.
  assert.equal(
    evaluateReturn(input({ reason: "damaged", now: daysLater(4) })).eligible,
    false,
  );
});

test("refuses pierced jewellery once the seal is broken", () => {
  const result = evaluateReturn(
    input({ isPiercedJewellery: true, sealIntact: false }),
  );
  assert.equal(result.eligible, false);
  assert.match(result.refusal ?? "", /hygiene/i);
});

test("accepts pierced jewellery with the seal intact", () => {
  assert.equal(
    evaluateReturn(input({ isPiercedJewellery: true, sealIntact: true })).eligible,
    true,
  );
});

test("the hygiene rule never blocks a faulty item", () => {
  // Using a hygiene exception to refuse a damaged or wrong item would be
  // dodging a defect behind a rule written for change-of-mind returns.
  for (const reason of ["damaged", "wrong_item", "not_as_described"] as const) {
    const result = evaluateReturn(
      input({
        reason,
        isPiercedJewellery: true,
        sealIntact: false,
        now: daysLater(1),
      }),
    );
    assert.equal(result.eligible, true, `refused a ${reason} return on hygiene`);
  }
});

test("we pay return shipping when the fault is ours", () => {
  assert.equal(
    evaluateReturn(input({ reason: "wrong_item" })).freeReturnShipping,
    true,
  );
  assert.equal(
    evaluateReturn(input({ reason: "changed_mind" })).freeReturnShipping,
    false,
  );
});

test("classifies fault correctly", () => {
  assert.equal(isFault("damaged"), true);
  assert.equal(isFault("size_or_fit"), false);
});

test("routes a COD refund to UPI, not a card", () => {
  // A COD order never had a payment instrument to refund to.
  assert.equal(
    evaluateReturn(input({ paymentMethod: "cod" })).refundTo,
    "upi",
  );
  assert.equal(
    evaluateReturn(input({ paymentMethod: "card" })).refundTo,
    "original_payment_method",
  );
});

test("counts whole days elapsed", () => {
  assert.equal(daysSince(DELIVERED, daysLater(0)), 0);
  assert.equal(daysSince(DELIVERED, new Date(DELIVERED.getTime() + 86_399_000)), 0);
  assert.equal(daysSince(DELIVERED, daysLater(3)), 3);
});

test("a return can still be rejected at quality check", () => {
  // Approving on request does not commit us to refunding something that comes
  // back worn.
  assert.ok(canTransitionRma("received", "rejected"));
  assert.equal(transitionRma("received", "refunded"), "refunded");
});

test("refuses illegal return transitions", () => {
  assert.throws(() => transitionRma("requested", "refunded"));
  assert.throws(() => transitionRma("refunded", "received"));
  assert.throws(() => transitionRma("rejected", "approved"));
});
