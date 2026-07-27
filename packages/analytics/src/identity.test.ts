import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hashIdentity,
  mintEventId,
  normaliseEmail,
  normalisePhone,
  sha256,
} from "./identity.ts";
import { DEFAULT_CONSENT, FULL_CONSENT } from "./consent.ts";

test("normalises Indian phone numbers to E.164 without the plus", () => {
  // Every one of these is the same subscriber; all must hash identically.
  for (const raw of [
    "9876543210",
    "+91 98765 43210",
    "91-9876-543210",
    "098765 43210",
    "919876543210",
  ]) {
    assert.equal(normalisePhone(raw), "919876543210", `failed for ${raw}`);
  }
});

test("rejects numbers that are not valid Indian mobiles", () => {
  assert.equal(normalisePhone("1234567890"), undefined); // bad leading digit
  assert.equal(normalisePhone("98765"), undefined);
  assert.equal(normalisePhone("98765432100"), undefined);
  assert.equal(normalisePhone("not a phone"), undefined);
});

test("normalises email by trimming and lowercasing", () => {
  assert.equal(normaliseEmail("  Asha@Example.COM "), "asha@example.com");
  assert.equal(normaliseEmail("nope"), undefined);
});

test("hashes with SHA-256", async () => {
  // Known digest for "abc".
  assert.equal(
    await sha256("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("differently formatted identifiers produce the same digest", async () => {
  const a = await hashIdentity({ phone: "+91 98765 43210" });
  const b = await hashIdentity({ phone: "09876543210" });
  // If this ever diverges, Event Match Quality silently drops and the same
  // customer stops matching across events.
  assert.equal(a.ph, b.ph);
});

test("never emits raw identifiers", async () => {
  const hashed = await hashIdentity({
    phone: "9876543210",
    email: "asha@example.com",
    customerId: "cus_123",
  });

  const serialised = JSON.stringify(hashed);
  assert.ok(!serialised.includes("9876543210"));
  assert.ok(!serialised.includes("asha@example.com"));
  assert.ok(!serialised.includes("cus_123"));
  assert.equal(hashed.ph?.length, 64);
});

test("omits identifiers that normalise to nothing", async () => {
  const hashed = await hashIdentity({ phone: "garbage", email: "garbage" });
  assert.equal(hashed.ph, undefined);
  assert.equal(hashed.em, undefined);
});

test("passes Meta cookies through unhashed", async () => {
  const hashed = await hashIdentity({ fbp: "fb.1.123.456", fbc: "fb.1.123.abc" });
  assert.equal(hashed.fbp, "fb.1.123.456");
  assert.equal(hashed.fbc, "fb.1.123.abc");
});

test("mints unique event ids", () => {
  const ids = new Set(Array.from({ length: 500 }, mintEventId));
  assert.equal(ids.size, 500);
});

test("consent defaults deny everything", () => {
  assert.equal(DEFAULT_CONSENT.ad_storage, "denied");
  assert.equal(FULL_CONSENT.ad_storage, "granted");
});
