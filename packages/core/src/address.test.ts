import assert from "node:assert/strict";
import { test } from "node:test";

import { scoreAddress, type AddressInput } from "./address.ts";

function address(overrides: Partial<AddressInput> = {}): AddressInput {
  return {
    line1: "Flat 3B, Sunrise Apartments, Linking Road",
    landmark: "Opposite Citi Bank",
    city: "Mumbai",
    stateCode: "27",
    pincode: "400050",
    ...overrides,
  };
}

test("a complete address scores well and needs no review", () => {
  const quality = scoreAddress(address());
  assert.ok(quality.score >= 85, `scored ${quality.score}`);
  assert.equal(quality.needsReview, false);
  assert.deepEqual(quality.issues, []);
});

test("a missing house number is penalised heavily", () => {
  const quality = scoreAddress(address({ line1: "Linking Road, Bandra West" }));
  assert.ok(quality.issues.some((i) => /house or flat/i.test(i)));
  assert.ok(quality.score < 75);
});

test("recognises Indian address forms", () => {
  for (const line1 of [
    "A-4, Green Park Colony",
    "House No. 12, Sector 15",
    "#7, 3rd Cross, Indiranagar",
    "302/A, Shanti Nagar Society",
  ]) {
    const quality = scoreAddress(address({ line1 }));
    assert.ok(
      !quality.issues.some((i) => /house or flat/i.test(i)),
      `missed house number in "${line1}"`,
    );
  }
});

test("flags filler text", () => {
  const quality = scoreAddress(address({ line1: "aaaaaaaaaaaa", landmark: "" }));
  assert.ok(quality.issues.some((i) => /filler/i.test(i)));
  assert.equal(quality.needsReview, true);
});

test("a very short address needs review", () => {
  const quality = scoreAddress(address({ line1: "abc", landmark: "" }));
  assert.equal(quality.needsReview, true);
});

test("a missing landmark costs a little, not a lot", () => {
  const withLandmark = scoreAddress(address());
  const without = scoreAddress(address({ landmark: "" }));
  assert.equal(withLandmark.score - without.score, 10);
});

test("never scores outside 0-100", () => {
  const worst = scoreAddress({
    line1: "",
    city: "",
    stateCode: "",
    pincode: "",
  });
  assert.ok(worst.score >= 0 && worst.score <= 100);
});
