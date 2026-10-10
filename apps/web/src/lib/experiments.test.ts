import assert from "node:assert/strict";
import { test } from "node:test";

import { newBucket, parseBucket, signInVariant } from "./experiments.ts";

test("buckets are 0–99 and anything else is no bucket", () => {
  assert.equal(parseBucket("0"), 0);
  assert.equal(parseBucket("99"), 99);
  assert.equal(parseBucket("100"), undefined);
  assert.equal(parseBucket("-1"), undefined);
  assert.equal(parseBucket("4x"), undefined);
  assert.equal(parseBucket(undefined), undefined);
  assert.equal(newBucket(() => 0.999999), 99);
  assert.equal(newBucket(() => 0), 0);
});

test("the share decides by bucket, and raising it only moves the next buckets", () => {
  const on = (percent: number) => ({ google: true, googlePercent: percent });
  assert.equal(signInVariant(10, on(50)), "google");
  assert.equal(signInVariant(60, on(50)), "phone");
  assert.equal(signInVariant(60, on(80)), "google");
  assert.equal(signInVariant(10, on(80)), "google", "stays where it was");
  assert.equal(signInVariant(0, on(0)), "phone");
  assert.equal(signInVariant(99, on(100)), "google");
});

test("Google off, or no bucket yet, is phone-only", () => {
  assert.equal(signInVariant(10, { google: false, googlePercent: 100 }), "phone");
  assert.equal(signInVariant(undefined, { google: true, googlePercent: 100 }), "phone");
});
