import assert from "node:assert/strict";
import { test } from "node:test";

import { createRazorpayClient } from "./razorpay.ts";

/** A fetch that answers from a script and records what it was asked. */
function fakeFetch(
  answers: Array<{ status: number; body: unknown }>,
): { fetch: typeof fetch; requests: Array<{ url: string; init: RequestInit }> } {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  let call = 0;
  const impl = (async (url: string | URL, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    const answer = answers[Math.min(call, answers.length - 1)]!;
    call += 1;
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      text: async () => JSON.stringify(answer.body),
    };
  }) as unknown as typeof fetch;
  return { fetch: impl, requests };
}

const KEYS = { keyId: "rzp_test_abc", keySecret: "secret123" };

test("authenticates with basic auth and creates an auto-capture order", async () => {
  const { fetch, requests } = fakeFetch([
    { status: 200, body: { id: "order_x1", status: "created" } },
  ]);
  const client = createRazorpayClient({ ...KEYS, fetch });

  const result = await client.createOrder({
    amountPaise: 199000,
    receipt: "SIU-00001",
    notes: { order_number: "SIU-00001" },
  });

  assert.deepEqual(result, { ok: true, orderId: "order_x1" });

  const request = requests[0]!;
  assert.equal(request.url, "https://api.razorpay.com/v1/orders");
  const headers = request.init.headers as Record<string, string>;
  assert.equal(
    headers.authorization,
    `Basic ${Buffer.from("rzp_test_abc:secret123").toString("base64")}`,
  );

  const body = JSON.parse(String(request.init.body));
  assert.equal(body.amount, 199000);
  assert.equal(body.currency, "INR");
  // Auto-capture is the settled policy; the explicit capture call exists only
  // for the authorized-drop fallback.
  assert.equal(body.payment_capture, 1);
  assert.equal(body.notes.order_number, "SIU-00001");
});

test("a provider refusal comes back as an outcome, not a throw", async () => {
  const { fetch } = fakeFetch([
    { status: 400, body: { error: { description: "amount too small" } } },
  ]);
  const client = createRazorpayClient({ ...KEYS, fetch });

  const result = await client.createOrder({ amountPaise: 1, receipt: "SIU-00002" });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.match(result.error, /HTTP 400/);
  }
});

test("a dropped socket is an outcome too", async () => {
  const failing = (async () => {
    throw new Error("ECONNRESET");
  }) as unknown as typeof fetch;
  const client = createRazorpayClient({ ...KEYS, fetch: failing });

  const result = await client.fetchOrderPayments("order_x1");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /ECONNRESET/);
});

test("lists an order's payments from the provider's envelope", async () => {
  const { fetch, requests } = fakeFetch([
    {
      status: 200,
      body: { items: [{ id: "pay_1", status: "captured", amount: 199000 }] },
    },
  ]);
  const client = createRazorpayClient({ ...KEYS, fetch });

  const result = await client.fetchOrderPayments("order_x1");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payments.length, 1);
    assert.equal(result.payments[0]!.status, "captured");
  }
  assert.match(requests[0]!.url, /\/orders\/order_x1\/payments$/);
});

test("captures and refunds against the payment id", async () => {
  const { fetch, requests } = fakeFetch([
    { status: 200, body: { id: "pay_1", status: "captured" } },
    { status: 200, body: { id: "rfnd_1" } },
  ]);
  const client = createRazorpayClient({ ...KEYS, fetch });

  const captured = await client.capturePayment("pay_1", 199000);
  assert.deepEqual(captured, { ok: true, status: "captured" });
  assert.match(requests[0]!.url, /\/payments\/pay_1\/capture$/);

  const refunded = await client.refundPayment("pay_1", { amountPaise: 199000 });
  assert.deepEqual(refunded, { ok: true, refundId: "rfnd_1" });
  assert.match(requests[1]!.url, /\/payments\/pay_1\/refund$/);
});
