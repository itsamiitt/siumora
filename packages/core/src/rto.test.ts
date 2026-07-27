import assert from "node:assert/strict";
import { test } from "node:test";

import { scoreAddress } from "./address.ts";
import { evaluateCod } from "./cod.ts";
import { bandFor, explainRto, scoreRto, type RtoFactors } from "./rto.ts";

function factors(overrides: Partial<RtoFactors> = {}): RtoFactors {
  return {
    paymentMethod: "cod",
    orderValue: 200000,
    addressScore: 75,
    phoneVerified: true,
    ...overrides,
  };
}

test("prepaid orders carry no RTO risk", () => {
  // Gating a prepaid order would cost a sale for nothing — the money is taken.
  const result = scoreRto(factors({ paymentMethod: "prepaid", addressScore: 10 }));
  assert.equal(result.score, 0);
  assert.equal(result.risk, "low");
});

test("a clean COD order from a trusted customer stays low risk", () => {
  const result = scoreRto(
    factors({ addressScore: 90, successfulOrders: 5, pincodeRtoRate: 0.03 }),
  );
  assert.equal(result.risk, "low");
});

test("a bad address drives risk up sharply", () => {
  const good = scoreRto(factors({ addressScore: 90 }));
  const bad = scoreRto(factors({ addressScore: 20 }));
  assert.ok(bad.score > good.score + 30, `${bad.score} vs ${good.score}`);
  assert.notEqual(bad.risk, "low");
});

test("previous returns to origin push a customer to high risk", () => {
  const result = scoreRto(factors({ previousRtos: 2, isNewCustomer: false }));
  assert.equal(result.risk, "high");
});

test("delivered history outweighs a first-order penalty", () => {
  const newCustomer = scoreRto(factors({ isNewCustomer: true }));
  const repeat = scoreRto(factors({ successfulOrders: 4 }));
  assert.ok(repeat.score < newCustomer.score);
});

test("an unverified phone raises risk over a verified one", () => {
  const verified = scoreRto(factors({ phoneVerified: true }));
  const unverified = scoreRto(factors({ phoneVerified: false }));
  assert.equal(unverified.score - verified.score, 20);
});

test("a bad pincode history raises risk", () => {
  const good = scoreRto(factors({ pincodeRtoRate: 0.02 }));
  const bad = scoreRto(factors({ pincodeRtoRate: 0.4 }));
  assert.ok(bad.score > good.score);
});

test("scores stay inside 0-100 at both extremes", () => {
  const worst = scoreRto(
    factors({
      addressScore: 0,
      previousRtos: 9,
      pincodeRtoRate: 0.9,
      phoneVerified: false,
      orderValue: 900000,
      isNewCustomer: true,
    }),
  );
  const best = scoreRto(
    factors({
      addressScore: 100,
      successfulOrders: 20,
      pincodeRtoRate: 0,
      phoneVerified: true,
    }),
  );

  assert.ok(worst.score <= 100 && worst.score >= 0);
  assert.ok(best.score <= 100 && best.score >= 0);
  assert.equal(worst.risk, "high");
  assert.equal(best.risk, "low");
});

test("bands map to the documented thresholds", () => {
  assert.equal(bandFor(0), "low");
  assert.equal(bandFor(34), "low");
  assert.equal(bandFor(35), "medium");
  assert.equal(bandFor(59), "medium");
  assert.equal(bandFor(60), "high");
});

test("every scored order explains itself", () => {
  const result = scoreRto(factors({ addressScore: 20, previousRtos: 1 }));
  assert.ok(result.contributions.length > 0);

  const explanation = explainRto(result);
  assert.match(explanation, /HIGH|MEDIUM/);
  // An ops person must be able to read the reason, not just the number.
  assert.match(explanation, /Address score/);
});

test("the risk band drives the COD decision end to end", () => {
  const address = scoreAddress({
    line1: "x",
    city: "",
    stateCode: "27",
    pincode: "400001",
  });

  const risk = scoreRto(
    factors({ addressScore: address.score, phoneVerified: false, previousRtos: 1 }),
  );
  const decision = evaluateCod({
    subtotal: 200000,
    pincodeCodServiceable: true,
    rtoRisk: risk.risk,
  });

  // A junk address on an unverified phone must not ship on trust.
  assert.equal(risk.risk, "high");
  assert.equal(decision.verification, "partial-payment");
});
