import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_RULES, createRateLimiter, type RateRule } from "./rate-limit.ts";

const RULES: readonly RateRule[] = [
  { prefix: "/auth/", method: "POST", limit: 3, windowMs: 60_000, bucket: "auth" },
  { prefix: "/checkout", method: "POST", limit: 2, windowMs: 60_000 },
];

test("allows up to the limit and refuses the next", () => {
  const limiter = createRateLimiter(RULES);
  for (let n = 0; n < 3; n += 1) {
    assert.equal(limiter.check("1.1.1.1", "/auth/otp", "POST").allowed, true, `${n}`);
  }
  assert.equal(limiter.check("1.1.1.1", "/auth/otp", "POST").allowed, false);
});

test("keeps origins apart", () => {
  // One noisy address must not lock everyone else out — behind a mobile
  // carrier's NAT that would be an entire city.
  const limiter = createRateLimiter(RULES);
  for (let n = 0; n < 4; n += 1) limiter.check("1.1.1.1", "/auth/otp", "POST");

  assert.equal(limiter.check("2.2.2.2", "/auth/otp", "POST").allowed, true);
});

test("shares one budget across the paths that name a bucket", () => {
  // Otherwise a script alternates /auth/otp and /auth/verify and gets double.
  const limiter = createRateLimiter(RULES);
  limiter.check("1.1.1.1", "/auth/otp", "POST");
  limiter.check("1.1.1.1", "/auth/verify", "POST");
  limiter.check("1.1.1.1", "/auth/otp", "POST");

  assert.equal(limiter.check("1.1.1.1", "/auth/verify", "POST").allowed, false);
});

test("counts methods separately when a rule names one", () => {
  const limiter = createRateLimiter(RULES);
  for (let n = 0; n < 5; n += 1) limiter.check("1.1.1.1", "/checkout", "POST");

  // The rule is POST-only, so a GET is not covered and is not refused.
  assert.equal(limiter.check("1.1.1.1", "/checkout", "GET").allowed, true);
});

test("forgets the window once it rolls over", () => {
  const limiter = createRateLimiter(RULES);
  const start = 1_000_000;
  for (let n = 0; n < 4; n += 1) limiter.check("1.1.1.1", "/auth/otp", "POST", start);

  assert.equal(
    limiter.check("1.1.1.1", "/auth/otp", "POST", start + 60_001).allowed,
    true,
  );
});

test("says how long to wait, never zero", () => {
  const limiter = createRateLimiter(RULES);
  const start = 1_000_000;
  for (let n = 0; n < 4; n += 1) limiter.check("1.1.1.1", "/auth/otp", "POST", start);

  // A client told to retry after 0 seconds retries immediately, which is the
  // behaviour the limit exists to stop.
  const decision = limiter.check("1.1.1.1", "/auth/otp", "POST", start + 59_900);
  assert.equal(decision.allowed, false);
  assert.ok(decision.retryAfterSeconds >= 1);
});

test("does not limit a path no rule names", () => {
  // Listing everything would put a ceiling on the health check and on courier
  // webhooks, where a burst is a backlog clearing rather than an attack.
  const limiter = createRateLimiter(RULES);
  for (let n = 0; n < 100; n += 1) {
    assert.equal(limiter.check("1.1.1.1", "/health", "GET").allowed, true);
  }
});

test("drops windows that have rolled over instead of growing forever", () => {
  const limiter = createRateLimiter(RULES);
  const start = 1_000_000;
  for (let n = 0; n < 50; n += 1) {
    limiter.check(`10.0.0.${n}`, "/auth/otp", "POST", start);
  }
  assert.equal(limiter.size, 50);

  assert.equal(limiter.sweep(start + 60_001), 50);
  assert.equal(limiter.size, 0);
});

test("the shipped rules cover what plan/11 §4 names", () => {
  const covered = (path: string, method: string) => {
    const limiter = createRateLimiter(DEFAULT_RULES);
    let refusedAt = 0;
    for (let n = 1; n <= 500; n += 1) {
      if (!limiter.check("1.1.1.1", path, method).allowed) {
        refusedAt = n;
        break;
      }
    }
    return refusedAt;
  };

  assert.ok(covered("/auth/otp", "POST") > 0, "auth");
  assert.ok(covered("/checkout", "POST") > 0, "checkout");
  assert.ok(covered("/products?q=jhumka", "GET") > 0, "search");
  // Guessing an order access key is hopeless against a uuid, but every guess
  // still costs a query.
  assert.ok(covered("/orders/SIU-00001", "GET") > 0, "order lookup");
});
