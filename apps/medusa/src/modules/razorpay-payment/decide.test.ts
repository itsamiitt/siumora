import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  majorFromPaise,
  paiseFromMajor,
  parseWebhook,
  readPayments,
  reconAction,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "./decide.ts";

const sign = (secret: string, body: string) =>
  createHmac("sha256", secret).update(body).digest("hex");

// ── Webhook signatures (parity: "rejects an unsigned payment webhook",
//    "rejects a payment webhook signed with the wrong secret") ─────────────

test("a correctly signed webhook body verifies, as string or Buffer", () => {
  const body = '{"event":"payment.captured"}';
  assert.equal(verifyWebhookSignature(body, sign("whsec", body), "whsec"), true);
  assert.equal(verifyWebhookSignature(Buffer.from(body), sign("whsec", body), "whsec"), true);
});

test("an unsigned webhook is refused", () => {
  assert.equal(verifyWebhookSignature("{}", undefined, "whsec"), false);
});

test("a webhook signed with the wrong secret is refused", () => {
  assert.equal(verifyWebhookSignature("{}", sign("other", "{}"), "whsec"), false);
});

test("no configured secret refuses rather than skips", () => {
  assert.equal(verifyWebhookSignature("{}", sign("", "{}"), undefined), false);
});

test("a body changed after signing is refused", () => {
  const signature = sign("whsec", '{"amount":100}');
  assert.equal(verifyWebhookSignature('{"amount":1}', signature, "whsec"), false);
});

// ── Checkout signature ─────────────────────────────────────────────────────

test("the checkout handler's signature binds order and payment", () => {
  const signature = sign("key_secret", "order_A|pay_B");
  assert.equal(
    verifyCheckoutSignature({ orderId: "order_A", paymentId: "pay_B", signature }, "key_secret"),
    true,
  );
  assert.equal(
    verifyCheckoutSignature({ orderId: "order_A", paymentId: "pay_C", signature }, "key_secret"),
    false,
  );
  assert.equal(
    verifyCheckoutSignature({ orderId: "order_A", paymentId: "pay_B", signature }, undefined),
    false,
  );
});

// ── Money ──────────────────────────────────────────────────────────────────

test("Medusa amounts convert to whole paise, BigNumber included", () => {
  assert.equal(paiseFromMajor(2259), 225900);
  assert.equal(paiseFromMajor("79.49"), 7949);
  assert.equal(paiseFromMajor({ toJSON: () => 128 }), 12800);
  assert.throws(() => paiseFromMajor(1.005));
  assert.throws(() => paiseFromMajor(undefined));
  assert.equal(majorFromPaise(7949), 79.49);
  assert.throws(() => majorFromPaise(0.5));
});

// ── Reading an order's payments ────────────────────────────────────────────

test("a captured payment for the right amount reads captured", () => {
  assert.deepEqual(
    readPayments([{ id: "pay_1", status: "captured", amount: 225900 }], 225900),
    { state: "captured", paymentId: "pay_1" },
  );
});

test("a bare authorized payment reads authorized — the drop-off case to capture", () => {
  assert.deepEqual(
    readPayments(
      [
        { id: "pay_0", status: "failed", amount: 225900 },
        { id: "pay_1", status: "authorized", amount: 225900 },
      ],
      225900,
    ),
    { state: "authorized", paymentId: "pay_1" },
  );
});

test("captured wins over an earlier authorized attempt", () => {
  const reading = readPayments(
    [
      { id: "pay_1", status: "authorized", amount: 100 },
      { id: "pay_2", status: "captured", amount: 100 },
    ],
    100,
  );
  assert.deepEqual(reading, { state: "captured", paymentId: "pay_2" });
});

test("a payment for any other amount is never accepted", () => {
  assert.deepEqual(readPayments([{ id: "pay_1", status: "captured", amount: 100 }], 225900), {
    state: "mismatch",
    paymentId: "pay_1",
    amountPaise: 100,
  });
});

test("only failed attempts read pending; a refund reads refunded", () => {
  assert.deepEqual(readPayments([{ id: "pay_1", status: "failed" }], 100), { state: "pending" });
  assert.deepEqual(readPayments([], 100), { state: "pending" });
  assert.deepEqual(readPayments([{ id: "pay_1", status: "refunded", amount: 100 }], 100), {
    state: "refunded",
    paymentId: "pay_1",
  });
});

// ── Webhook bodies ─────────────────────────────────────────────────────────

const PAYMENT = {
  id: "pay_1",
  order_id: "order_1",
  amount: 225900,
  notes: { session_id: "payses_1" },
};

test("payment.captured routes to its session and amount", () => {
  assert.deepEqual(parseWebhook({ event: "payment.captured", payload: { payment: { entity: PAYMENT } } }), {
    kind: "captured",
    razorpayOrderId: "order_1",
    paymentId: "pay_1",
    amountPaise: 225900,
    sessionId: "payses_1",
  });
});

test("payment.authorized is the drop-off case; failed is failed", () => {
  assert.equal(
    parseWebhook({ event: "payment.authorized", payload: { payment: { entity: PAYMENT } } }).kind,
    "authorized",
  );
  assert.equal(
    parseWebhook({ event: "payment.failed", payload: { payment: { entity: PAYMENT } } }).kind,
    "failed",
  );
});

test("order.paid takes the session from the order's notes when the payment has none", () => {
  const event = parseWebhook({
    event: "order.paid",
    payload: {
      payment: { entity: { ...PAYMENT, notes: {} } },
      order: { entity: { id: "order_1", notes: { session_id: "payses_9" } } },
    },
  });
  assert.equal(event.kind, "captured");
  assert.equal(event.kind === "captured" && event.sessionId, "payses_9");
});

test("a session-less payment still routes by order id", () => {
  const event = parseWebhook({
    event: "payment.captured",
    payload: { payment: { entity: { ...PAYMENT, notes: [] } } },
  });
  assert.equal(event.kind, "captured");
  assert.equal("sessionId" in event, false);
});

test("other events and unroutable payloads are ignored, not errors", () => {
  assert.deepEqual(parseWebhook({ event: "refund.created", payload: {} }), {
    kind: "ignored",
    reason: "refund.created",
  });
  assert.equal(parseWebhook({ event: "payment.captured", payload: {} }).kind, "ignored");
  assert.equal(parseWebhook(null).kind, "ignored");
});

// ── Recon (parity: "the recon sweep confirms what the webhook missed") ─────

test("recon replays captured and authorized, flags a wrong amount, leaves the rest", () => {
  assert.equal(reconAction({ state: "captured", paymentId: "p" }), "captured");
  assert.equal(reconAction({ state: "authorized", paymentId: "p" }), "authorized");
  assert.equal(reconAction({ state: "mismatch", paymentId: "p", amountPaise: 1 }), "flag");
  assert.equal(reconAction({ state: "pending" }), "none");
  assert.equal(reconAction({ state: "refunded", paymentId: "p" }), "none");
});
