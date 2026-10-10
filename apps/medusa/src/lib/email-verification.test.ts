import assert from "node:assert/strict";
import { test } from "node:test";

import { VERIFIED_EMAIL_KEY, emailVerified, verificationLink, verificationMessage } from "./email-verification.ts";

test("verified means THIS address was verified, case aside", () => {
  assert.equal(emailVerified("Asha@Example.com", { [VERIFIED_EMAIL_KEY]: "asha@example.com" }), true);
  assert.equal(emailVerified("new@example.com", { [VERIFIED_EMAIL_KEY]: "asha@example.com" }), false, "a changed email is unverified again");
  assert.equal(emailVerified(null, { [VERIFIED_EMAIL_KEY]: "asha@example.com" }), false);
  assert.equal(emailVerified("asha@example.com", null), false);
});

test("the link lands on the storefront page with the token encoded", () => {
  assert.equal(
    verificationLink("https://siumora.com/", "a.b+c"),
    "https://siumora.com/account/verify-email?token=a.b%2Bc",
  );
  assert.match(verificationMessage("https://x/y"), /24 hours/);
});
