import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { RazorpayPaymentProviderService } from "./service.ts";

// The provider against a scripted Razorpay: every money path the parity
// checklist names for prepaid, run through the real class. Credentials come
// from the environment (no Postgres in a unit test — credentials.ts falls
// back to env when there is no connection).
process.env.RAZORPAY_KEY_ID = "rzp_test_key";
process.env.RAZORPAY_KEY_SECRET = "rzp_test_secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_test";

type Answer = { status: number; body: unknown };

function scripted(routes: Record<string, Answer | Answer[]>) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const seen: Record<string, number> = {};
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.replace(/^\/v1/, "");
    const method = String(init?.method ?? "GET");
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${path}`;
    const entry = routes[key];
    const list = Array.isArray(entry) ? entry : entry ? [entry] : [{ status: 404, body: {} }];
    const answer = list[Math.min(seen[key] ?? 0, list.length - 1)]!;
    seen[key] = (seen[key] ?? 0) + 1;
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      text: async () => JSON.stringify(answer.body),
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const SESSION = {
  razorpay_order_id: "order_1",
  amount_paise: 225900,
  key_id: "rzp_test_key",
  session_id: "payses_1",
  created_at: "2026-10-25T00:00:00.000Z",
};

const provider = (impl: typeof fetch) => new RazorpayPaymentProviderService({}, { fetch: impl });

test("a session opens a Razorpay order for the cart total in paise, routed back by session id", async () => {
  const { impl, calls } = scripted({ "POST /orders": { status: 200, body: { id: "order_9" } } });
  const result = await provider(impl).initiatePayment({
    amount: 2259,
    currency_code: "inr",
    data: { session_id: "payses_1" },
  });
  assert.equal(result.id, "order_9");
  assert.equal(result.status, "pending");
  assert.equal(result.data?.razorpay_order_id, "order_9");
  assert.equal(result.data?.amount_paise, 225900);
  assert.equal(result.data?.key_id, "rzp_test_key");
  assert.equal("key_secret" in (result.data ?? {}), false, "the secret never rides session data");
  assert.deepEqual(calls[0]!.body, {
    amount: 225900,
    currency: "INR",
    receipt: "payses_1",
    payment_capture: 1,
    notes: { session_id: "payses_1" },
  });
});

test("a refused order create is a calm error, not a raw provider message", async () => {
  const { impl } = scripted({ "POST /orders": { status: 500, body: { error: "down" } } });
  await assert.rejects(
    provider(impl).initiatePayment({ amount: 10, currency_code: "inr", data: {} }),
    /Nothing was charged/,
  );
});

test("a captured payment authorizes as captured and remembers the payment id", async () => {
  const { impl } = scripted({
    "GET /orders/order_1/payments": {
      status: 200,
      body: { items: [{ id: "pay_1", status: "captured", amount: 225900 }] },
    },
  });
  const result = await provider(impl).authorizePayment({ data: SESSION });
  assert.equal(result.status, "captured");
  assert.equal(result.data?.razorpay_payment_id, "pay_1");
});

test("a bare authorized payment is captured — the drop-off case", async () => {
  const { impl, calls } = scripted({
    "GET /orders/order_1/payments": {
      status: 200,
      body: { items: [{ id: "pay_1", status: "authorized", amount: 225900 }] },
    },
    "POST /payments/pay_1/capture": { status: 200, body: { status: "captured" } },
  });
  const result = await provider(impl).authorizePayment({ data: SESSION });
  assert.equal(result.status, "captured");
  assert.deepEqual(calls.at(-1)!.body, { amount: 225900, currency: "INR" });
});

test("a capture the provider refuses stays authorized, for recon to retry", async () => {
  const { impl } = scripted({
    "GET /orders/order_1/payments": {
      status: 200,
      body: { items: [{ id: "pay_1", status: "authorized", amount: 225900 }] },
    },
    "POST /payments/pay_1/capture": { status: 502, body: {} },
  });
  assert.equal((await provider(impl).authorizePayment({ data: SESSION })).status, "authorized");
});

test("no payment yet is pending — completion refuses rather than places", async () => {
  const { impl } = scripted({
    "GET /orders/order_1/payments": { status: 200, body: { items: [] } },
  });
  assert.equal((await provider(impl).authorizePayment({ data: SESSION })).status, "pending");
});

test("a payment for another amount is an error, never an order", async () => {
  const { impl } = scripted({
    "GET /orders/order_1/payments": {
      status: 200,
      body: { items: [{ id: "pay_1", status: "captured", amount: 100 }] },
    },
  });
  assert.equal((await provider(impl).authorizePayment({ data: SESSION })).status, "error");
});

test("refunds go against the payment id, in paise", async () => {
  const { impl, calls } = scripted({
    "POST /payments/pay_1/refund": { status: 200, body: { id: "rfnd_1" } },
  });
  const result = await provider(impl).refundPayment({
    amount: 2259,
    data: { ...SESSION, razorpay_payment_id: "pay_1" },
  });
  assert.equal(result.data?.last_refund_id, "rfnd_1");
  assert.deepEqual(calls[0]!.body, { amount: 225900, notes: { razorpay_order_id: "order_1" } });
});

test("a changed total opens a new Razorpay order; the same total keeps the old one", async () => {
  const { impl, calls } = scripted({ "POST /orders": { status: 200, body: { id: "order_2" } } });
  const same = await provider(impl).updatePayment({ amount: 2259, currency_code: "inr", data: SESSION });
  assert.equal(same.data?.razorpay_order_id, "order_1");
  assert.equal(calls.length, 0);
  const changed = await provider(impl).updatePayment({ amount: 2308, currency_code: "inr", data: SESSION });
  assert.equal(changed.data?.razorpay_order_id, "order_2");
  assert.equal(changed.data?.amount_paise, 230800);
});

// ── Webhooks ───────────────────────────────────────────────────────────────

const capturedBody = JSON.stringify({
  event: "payment.captured",
  payload: {
    payment: {
      entity: { id: "pay_1", order_id: "order_1", amount: 225900, notes: { session_id: "payses_1" } },
    },
  },
});
const signed = (body: string, secret = "whsec_test") =>
  createHmac("sha256", secret).update(body).digest("hex");

test("a signed payment.captured routes to its session with the amount in rupees", async () => {
  const { impl } = scripted({});
  const result = await provider(impl).getWebhookActionAndData({
    data: JSON.parse(capturedBody),
    rawData: Buffer.from(capturedBody),
    headers: { "x-razorpay-signature": signed(capturedBody) },
  });
  assert.deepEqual(result, { action: "captured", data: { session_id: "payses_1", amount: 2259 } });
});

test("an unsigned or wrongly signed webhook is not acted on", async () => {
  const { impl } = scripted({});
  const unsigned = await provider(impl).getWebhookActionAndData({
    data: JSON.parse(capturedBody),
    rawData: Buffer.from(capturedBody),
    headers: {},
  });
  assert.deepEqual(unsigned, { action: "not_supported" });
  const forged = await provider(impl).getWebhookActionAndData({
    data: JSON.parse(capturedBody),
    rawData: Buffer.from(capturedBody),
    headers: { "x-razorpay-signature": signed(capturedBody, "guess") },
  });
  assert.deepEqual(forged, { action: "not_supported" });
});
