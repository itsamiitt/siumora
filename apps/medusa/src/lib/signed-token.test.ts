import assert from "node:assert/strict";
import { test } from "node:test";

import { issueToken, readToken } from "./signed-token.ts";

const SECRET = "test-secret";
const NOW = new Date("2026-10-10T10:00:00Z");

test("a token reads back with its claims until it expires", () => {
  const token = issueToken("google_link", { authIdentityId: "authid_1" }, 600, SECRET, NOW);
  const payload = readToken(token, "google_link", SECRET, new Date(NOW.getTime() + 599_000));
  assert.equal(payload?.authIdentityId, "authid_1");
  assert.equal(readToken(token, "google_link", SECRET, new Date(NOW.getTime() + 600_000)), undefined);
});

test("one purpose can never be replayed as another", () => {
  const token = issueToken("email_verify", { customerId: "cus_1" }, 600, SECRET, NOW);
  assert.equal(readToken(token, "google_link", SECRET, NOW), undefined);
});

test("a changed byte, a different secret, or junk reads as nothing", () => {
  const token = issueToken("google_link", { authIdentityId: "authid_1" }, 600, SECRET, NOW);
  const [body, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ authIdentityId: "authid_2", purpose: "google_link", exp: 9e9 })).toString("base64url");
  assert.equal(readToken(`${forged}.${signature}`, "google_link", SECRET, NOW), undefined);
  assert.equal(readToken(`${body}.${signature}x`, "google_link", SECRET, NOW), undefined);
  assert.equal(readToken(token, "google_link", "other-secret", NOW), undefined);
  assert.equal(readToken("not.a.token", "google_link", SECRET, NOW), undefined);
  assert.equal(readToken(undefined, "google_link", SECRET, NOW), undefined);
});
