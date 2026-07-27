import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COD_FEE,
  COD_MAX_ORDER,
  COD_MIN_ORDER,
  COD_PARTIAL_PAYMENT,
  evaluateCod,
  type CodInput,
} from "./cod.ts";

function input(overrides: Partial<CodInput> = {}): CodInput {
  return {
    subtotal: 200000,
    pincodeCodServiceable: true,
    rtoRisk: "low",
    ...overrides,
  };
}

test("offers COD with a fee on a low-risk serviceable order", () => {
  const decision = evaluateCod(input());
  assert.equal(decision.available, true);
  assert.equal(decision.fee, COD_FEE);
  assert.equal(decision.verification, "none");
});

test("withholds COD where the courier does not carry it", () => {
  const decision = evaluateCod(input({ pincodeCodServiceable: false }));
  assert.equal(decision.available, false);
  assert.match(decision.reason ?? "", /pincode/i);
});

test("withholds COD outside the value band", () => {
  assert.equal(evaluateCod(input({ subtotal: COD_MIN_ORDER - 1 })).available, false);
  assert.equal(evaluateCod(input({ subtotal: COD_MAX_ORDER + 1 })).available, false);
  // The bounds themselves are inclusive.
  assert.equal(evaluateCod(input({ subtotal: COD_MIN_ORDER })).available, true);
  assert.equal(evaluateCod(input({ subtotal: COD_MAX_ORDER })).available, true);
});

test("asks medium risk to confirm by OTP", () => {
  const decision = evaluateCod(input({ rtoRisk: "medium" }));
  assert.equal(decision.available, true);
  assert.equal(decision.verification, "otp");
});

test("converts high risk into a deposit rather than refusing the sale", () => {
  const decision = evaluateCod(input({ rtoRisk: "high" }));
  assert.equal(decision.available, true);
  assert.equal(decision.verification, "partial-payment");
  assert.equal(decision.partialPayment, COD_PARTIAL_PAYMENT);
});

test("waives the fee for trusted repeat customers", () => {
  const decision = evaluateCod(input({ successfulOrders: 3 }));
  assert.equal(decision.fee, 0);
});

test("skips the OTP step for a trusted customer at medium risk", () => {
  const decision = evaluateCod(input({ rtoRisk: "medium", successfulOrders: 5 }));
  assert.equal(decision.verification, "none");
  assert.equal(decision.fee, 0);
});

test("still takes a deposit from a trusted customer at high risk", () => {
  // Trust waives friction, not the deposit — high risk is about this order.
  const decision = evaluateCod(input({ rtoRisk: "high", successfulOrders: 9 }));
  assert.equal(decision.verification, "partial-payment");
});
