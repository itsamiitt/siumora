import { test } from "node:test";
import assert from "node:assert/strict";

import { auditUnplacedRefund } from "./payment-audit.ts";

function capture() {
  const calls: Array<{ sql: string; bindings: ReadonlyArray<unknown> }> = [];
  return {
    calls,
    client: {
      async raw(sql: string, bindings: ReadonlyArray<string | number | boolean | null>) {
        calls.push({ sql, bindings });
        return { rows: [] };
      },
    },
  };
}

test("a refund of an unplaced payment leaves one audit row naming the money", async () => {
  const { calls, client } = capture();
  await auditUnplacedRefund(client, {
    source: "checkout",
    razorpayOrderId: "order_R1",
    paymentId: "pay_P1",
    amountPaise: 199000,
    sessionId: "payses_1",
    ok: true,
    refundId: "rfnd_1",
  });
  assert.equal(calls.length, 1);
  const bindings = calls[0]!.bindings;
  assert.ok(bindings.includes("payment.refund_unplaced"));
  assert.ok(bindings.includes("system"));
  assert.ok(bindings.includes("pay_P1"));
  const detail = JSON.parse(String(bindings.find((b) => typeof b === "string" && b.startsWith("{"))));
  assert.deepEqual(detail, {
    amountPaise: 199000,
    razorpayOrderId: "order_R1",
    cartId: null,
    sessionId: "payses_1",
    refundId: "rfnd_1",
  });
});

test("a failed refund is recorded as the one that still owes money", async () => {
  const { calls, client } = capture();
  await auditUnplacedRefund(client, {
    source: "recon",
    paymentId: "pay_P2",
    amountPaise: 5000,
    ok: false,
    error: "BAD_REQUEST_ERROR",
  });
  assert.ok(calls[0]!.bindings.includes("payment.refund_unplaced_failed"));
  assert.ok(calls[0]!.bindings.includes("payment-recon"));
});

test("a broken audit table never throws into the refund path", async () => {
  await auditUnplacedRefund(
    { raw: async () => { throw new Error("relation does not exist"); } },
    { source: "checkout", paymentId: "pay_P3", amountPaise: 1, ok: true },
  );
});
