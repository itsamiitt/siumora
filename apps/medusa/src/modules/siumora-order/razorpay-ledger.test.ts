import assert from "node:assert/strict";
import { test } from "node:test";

import { mayRevealAccessKey } from "./identity.ts";
import { settlementOf } from "./payment-method.ts";
import { LEDGER_EXPIRE_MS, LEDGER_GRACE_MS, ledgerAction, refundPaise } from "./razorpay-ledger.ts";

const OLD = LEDGER_GRACE_MS + 60_000;
const base = { recorded: false, liveSession: false, cartCompleted: false, ageMs: OLD };
const captured = { state: "captured", paymentId: "pay_1" } as const;

test("a capture on a superseded Razorpay order, past the grace period, is refunded", () => {
  assert.equal(ledgerAction({ ...base, reading: captured }), "refund");
});

test("a capture whose cart completed some other way is refunded, even with a session still naming it", () => {
  assert.equal(ledgerAction({ ...base, liveSession: true, cartCompleted: true, reading: captured }), "refund");
});

test("the order that completed the cart is never refunded here", () => {
  assert.equal(ledgerAction({ ...base, recorded: true, reading: captured }), "completed");
  assert.equal(ledgerAction({ ...base, recorded: true, ageMs: 0, reading: captured }), "completed");
});

test("a live session on an open cart is left to the regular replay", () => {
  assert.equal(ledgerAction({ ...base, liveSession: true, reading: captured }), "wait");
});

test("inside the grace period nothing happens; the shopper may still be paying", () => {
  assert.equal(ledgerAction({ ...base, ageMs: LEDGER_GRACE_MS - 1, reading: captured }), "wait");
});

test("unpaid waits then expires; refunded is recorded; authorized waits for capture", () => {
  assert.equal(ledgerAction({ ...base, reading: { state: "pending" } }), "wait");
  assert.equal(ledgerAction({ ...base, ageMs: LEDGER_EXPIRE_MS + 1, reading: { state: "pending" } }), "expired");
  assert.equal(ledgerAction({ ...base, reading: { state: "refunded", paymentId: "pay_1" } }), "refunded");
  assert.equal(ledgerAction({ ...base, reading: { state: "authorized", paymentId: "pay_1" } }), "wait");
});

test("a wrong-amount payment refunds what was actually taken", () => {
  const reading = { state: "mismatch", paymentId: "pay_1", amountPaise: 5_000 } as const;
  assert.equal(ledgerAction({ ...base, reading }), "refund");
  assert.equal(refundPaise(reading, { amount_paise: 9_900 }), 5_000);
  assert.equal(refundPaise(captured, { amount_paise: 9_900 }), 9_900);
});

test("settlement comes from the payment provider: Razorpay is prepaid, anything else COD", () => {
  assert.equal(settlementOf([{ provider_id: "pp_razorpay_razorpay" }]), "prepaid");
  assert.equal(settlementOf([{ provider_id: "pp_system_default" }]), "cod");
  assert.equal(settlementOf([]), "cod");
});

test("the access key goes only to a request that proved it is the buyer", () => {
  const none = { completedHere: false, keyReplay: false, paymentProven: false, ownerSignedIn: false };
  assert.equal(mayRevealAccessKey(none), false, "a bare replay of a completed cart id");
  assert.equal(mayRevealAccessKey({ ...none, completedHere: true }), true);
  assert.equal(mayRevealAccessKey({ ...none, keyReplay: true }), true);
  assert.equal(mayRevealAccessKey({ ...none, paymentProven: true }), true, "webhook placed it first");
  assert.equal(mayRevealAccessKey({ ...none, ownerSignedIn: true }), true);
});
