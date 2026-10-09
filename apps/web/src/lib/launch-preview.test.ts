import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PREVIEW_TTL_SECONDS, issuePreviewCookie, passwordMatches,
  publicDuringLaunch, validPreviewCookie,
} from "./launch-preview.ts";

const password = "long-preview-password";
const now = Date.UTC(2026, 9, 9);

test("preview cookie is signed, expires, and is revoked by changing the password", () => {
  const token = issuePreviewCookie(password, now);
  assert.equal(validPreviewCookie(token, password, now), true);
  assert.equal(validPreviewCookie(token, "different-long-password", now), false);
  assert.equal(validPreviewCookie(token, password, now + PREVIEW_TTL_SECONDS * 1000), false);
  assert.equal(validPreviewCookie(`${token.slice(0, -1)}0`, password, now), false);
  assert.equal(validPreviewCookie("v1.9999999999." + "0".repeat(64), password, now), false);
});

test("password comparison and public routes keep storefront requests gated", () => {
  assert.equal(passwordMatches(password, password), true);
  assert.equal(passwordMatches("incorrect", password), false);
  assert.equal(publicDuringLaunch("/api/waitlist"), true);
  assert.equal(publicDuringLaunch("/privacy"), true);
  assert.equal(publicDuringLaunch("/collections/everyday"), false);
  assert.equal(publicDuringLaunch("/api/orders/123"), false);
  assert.equal(publicDuringLaunch("/coming-soon/admin"), false);
});
