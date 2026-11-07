import assert from "node:assert/strict";
import { test } from "node:test";

import { installMoneyAlertCapture } from "./money-alert-capture.ts";

test("money-alert lines reach the sink, everything still logs", () => {
  const logged: unknown[][] = [];
  const target = {
    error: (...args: unknown[]) => logged.push(["error", ...args]),
    warn: (...args: unknown[]) => logged.push(["warn", ...args]),
  };
  const alerts: Array<[string, string]> = [];
  installMoneyAlertCapture([target], (message, level) => alerts.push([message, level]));

  target.error("[money-alert] REFUND FAILED: razorpay order_1");
  target.warn("[money-alert] provider credentials changed");
  target.error("ordinary failure");

  assert.equal(logged.length, 3);
  assert.deepEqual(alerts, [
    ["[money-alert] REFUND FAILED: razorpay order_1", "error"],
    ["[money-alert] provider credentials changed", "warning"],
  ]);
});

test("installing twice does not double-report, and a failing sink is swallowed", () => {
  const target = { error: (..._args: unknown[]) => undefined, warn: (..._args: unknown[]) => undefined };
  let calls = 0;
  installMoneyAlertCapture([target], () => {
    calls++;
    throw new Error("sink down");
  });
  installMoneyAlertCapture([target], () => {
    calls++;
  });
  assert.doesNotThrow(() => target.error("[money-alert] x"));
  assert.equal(calls, 1);
});
