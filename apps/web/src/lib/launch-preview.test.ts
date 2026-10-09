import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PREVIEW_TTL_SECONDS, issuePreviewCookie, passwordMatches,
  previewPasswordIsConfigured, previewSecretIsConfigured, publicDuringLaunch, validPreviewCookie,
} from "./launch-preview.ts";

const password = "0427";
const secret = "a-server-only-test-secret-with-at-least-32-characters";
const now = Date.UTC(2026, 9, 9);

test("preview cookie is signed, expires, and is revoked by changing the PIN or secret", () => {
  const token = issuePreviewCookie(password, secret, now);
  assert.equal(validPreviewCookie(token, password, secret, now), true);
  assert.equal(validPreviewCookie(token, "1234", secret, now), false);
  assert.equal(validPreviewCookie(token, password, "another-long-independent-server-signing-secret", now), false);
  assert.equal(validPreviewCookie(token, password, secret, now + PREVIEW_TTL_SECONDS * 1000), false);
  const tampered = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
  assert.equal(validPreviewCookie(tampered, password, secret, now), false);
  assert.equal(validPreviewCookie("v2.9999999999." + "0".repeat(64), password, secret, now), false);
  assert.equal(validPreviewCookie(token, password, undefined, now), false);
  assert.throws(() => issuePreviewCookie(password, password, now));
});

test("PIN configuration accepts exactly four ASCII digits, including leading zeros", () => {
  assert.equal(previewPasswordIsConfigured("0000"), true);
  assert.equal(previewPasswordIsConfigured(password), true);
  for (const value of [undefined, null, 427, "427", "04270", "abcd", " 0427", "0427\n", "１２３４"]) {
    assert.equal(previewPasswordIsConfigured(value), false);
  }
  assert.equal(previewSecretIsConfigured(secret), true);
  assert.equal(previewSecretIsConfigured(password), false);
});

test("password comparison and public routes keep storefront requests gated", () => {
  assert.equal(passwordMatches(password, password), true);
  assert.equal(passwordMatches("incorrect", password), false);
  assert.equal(publicDuringLaunch("/api/waitlist"), true);
  assert.equal(publicDuringLaunch("/privacy"), true);
  assert.equal(publicDuringLaunch("/coming-soon/atelier.webp"), true);
  assert.equal(publicDuringLaunch("/collections/everyday"), false);
  assert.equal(publicDuringLaunch("/api/orders/123"), false);
  assert.equal(publicDuringLaunch("/coming-soon/admin"), false);
});
