import assert from "node:assert/strict";
import { test } from "node:test";

import {
  closedNativeCompletion,
  guardNativeCartWrite,
  guardPaymentSessionCreate,
  serverOwnedKeys,
  type GuardRequest,
} from "./store-cart-guard.ts";

function run(
  handler: (req: GuardRequest, res: never, next: () => void) => void,
  req: GuardRequest,
) {
  const sent: { status?: number; body?: unknown; passed: boolean } = { passed: false };
  const res = {
    status(code: number) {
      sent.status = code;
      return { json: (body: unknown) => (sent.body = body) };
    },
  };
  handler(req, res as never, () => (sent.passed = true));
  return sent;
}

test("native cart writes refuse promo_codes — coupons go through /store/siumora/coupons", () => {
  const sent = run(guardNativeCartWrite, { method: "POST", body: { promo_codes: ["WELCOME10"] } });
  assert.equal(sent.status, 400);
  assert.equal(sent.passed, false);
});

test("native cart writes refuse server-owned siumora_* metadata", () => {
  const sent = run(guardNativeCartWrite, {
    method: "POST",
    body: { metadata: { siumora_payment_method: "upi", note: "x" } },
  });
  assert.equal(sent.status, 400);
  assert.match(String((sent.body as { message: string }).message), /siumora_payment_method/);
});

test("the storefront's own metadata keys and ordinary fields pass", () => {
  const sent = run(guardNativeCartWrite, {
    method: "POST",
    body: {
      email: "x@example.com",
      metadata: {
        siumora_event_id: "evt",
        siumora_ga_client_id: "ga",
        siumora_consent: "full",
        siumora_gift_message: "Happy birthday",
        other: 1,
      },
      shipping_address: { phone: "9876543210" },
    },
  });
  assert.equal(sent.passed, true);
  assert.equal(sent.status, undefined);
});

test("serverOwnedKeys ignores non-objects", () => {
  assert.deepEqual(serverOwnedKeys(null), []);
  assert.deepEqual(serverOwnedKeys(["siumora_x"]), []);
  assert.deepEqual(serverOwnedKeys({ siumora_merged_into: "cart_2" }), ["siumora_merged_into"]);
});

test("native completion is closed", () => {
  const sent = run(closedNativeCompletion as never, { method: "POST" });
  assert.equal(sent.status, 404);
  assert.equal(sent.passed, false);
});

test("a shopper cannot open a system-provider (COD) session; Razorpay passes to Medusa", () => {
  assert.equal(run(guardPaymentSessionCreate, { method: "POST", body: { provider_id: "pp_system_default" } }).status, 404);
  assert.equal(run(guardPaymentSessionCreate, { method: "POST", body: { provider_id: "pp_razorpay_razorpay" } }).passed, true);
});
