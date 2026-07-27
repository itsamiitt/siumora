import assert from "node:assert/strict";
import { test } from "node:test";

import { isValidPincode, normalisePincodeInput } from "./pincode.ts";

test("accepts six-digit pincodes that do not start with zero", () => {
  assert.equal(isValidPincode("400001"), true);
  assert.equal(isValidPincode(" 110001 "), true);
});

test("rejects malformed pincodes", () => {
  assert.equal(isValidPincode("012345"), false);
  assert.equal(isValidPincode("40001"), false);
  assert.equal(isValidPincode("4000011"), false);
  assert.equal(isValidPincode("40a001"), false);
});

test("normalises input to at most six digits", () => {
  assert.equal(normalisePincodeInput("400-001"), "400001");
  assert.equal(normalisePincodeInput("4000019999"), "400001");
});
