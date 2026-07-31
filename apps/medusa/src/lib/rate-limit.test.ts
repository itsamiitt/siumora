import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_RULES,
  createRateLimiter,
  limiterFromEnv,
  rateLimitMiddleware,
  type LimiterRequest,
  type LimiterResponse,
  type RateRule,
} from "./rate-limit.ts";

/**
 * The 9 behaviors ported from apps/api/src/lib/rate-limit.test.ts — same
 * names as the parity checklist rows (docs/medusa-parity-checklist.md), same
 * assertions, paths re-shaped onto Medusa's route tree. Below them, the
 * middleware- and boot-level tests this stack adds.
 */

const RULES: readonly RateRule[] = [
  { prefix: "/auth/", method: "POST", limit: 3, windowMs: 60_000, bucket: "auth" },
  { prefix: "/store/siumora/checkout", method: "POST", limit: 2, windowMs: 60_000 },
];

test("allows up to the limit and refuses the next", () => {
  const limiter = createRateLimiter(RULES);
  for (let n = 0; n < 3; n += 1) {
    assert.equal(limiter.check("1.1.1.1", "/auth/customer/otp", "POST").allowed, true, `${n}`);
  }
  assert.equal(limiter.check("1.1.1.1", "/auth/customer/otp", "POST").allowed, false);
});

test("keeps origins apart", () => {
  // One noisy address must not lock everyone else out — behind a mobile
  // carrier's NAT that would be an entire city.
  const limiter = createRateLimiter(RULES);
  for (let n = 0; n < 4; n += 1) limiter.check("1.1.1.1", "/auth/customer/otp", "POST");

  assert.equal(limiter.check("2.2.2.2", "/auth/customer/otp", "POST").allowed, true);
});

test("shares one budget across the paths that name a bucket", () => {
  // Otherwise a script alternates the OTP generate and verify routes and
  // gets double.
  const limiter = createRateLimiter(RULES);
  limiter.check("1.1.1.1", "/auth/customer/otp", "POST");
  limiter.check("1.1.1.1", "/auth/customer/otp/verify", "POST");
  limiter.check("1.1.1.1", "/auth/customer/otp", "POST");

  assert.equal(limiter.check("1.1.1.1", "/auth/customer/otp/verify", "POST").allowed, false);
});

test("counts methods separately when a rule names one", () => {
  const limiter = createRateLimiter(RULES);
  for (let n = 0; n < 5; n += 1) limiter.check("1.1.1.1", "/store/siumora/checkout", "POST");

  // The rule is POST-only, so a GET is not covered and is not refused.
  assert.equal(limiter.check("1.1.1.1", "/store/siumora/checkout", "GET").allowed, true);
});

test("forgets the window once it rolls over", () => {
  const limiter = createRateLimiter(RULES);
  const start = 1_000_000;
  for (let n = 0; n < 4; n += 1) limiter.check("1.1.1.1", "/auth/customer/otp", "POST", start);

  assert.equal(
    limiter.check("1.1.1.1", "/auth/customer/otp", "POST", start + 60_001).allowed,
    true,
  );
});

test("says how long to wait, never zero", () => {
  const limiter = createRateLimiter(RULES);
  const start = 1_000_000;
  for (let n = 0; n < 4; n += 1) limiter.check("1.1.1.1", "/auth/customer/otp", "POST", start);

  // A client told to retry after 0 seconds retries immediately, which is the
  // behaviour the limit exists to stop.
  const decision = limiter.check("1.1.1.1", "/auth/customer/otp", "POST", start + 59_900);
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
    limiter.check(`10.0.0.${n}`, "/auth/customer/otp", "POST", start);
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

  assert.ok(covered("/auth/customer/otp", "POST") > 0, "auth");
  assert.ok(covered("/store/siumora/checkout", "POST") > 0, "checkout");
  assert.ok(covered("/store/products?q=jhumka", "GET") > 0, "search");
  // Guessing an order access key is hopeless against a uuid, but every guess
  // still costs a query.
  assert.ok(covered("/store/siumora/orders/SIU-00001", "GET") > 0, "order lookup");
  // The two classes this stack adds: cart building, and the namespace
  // catch-all that gives routes not yet written a ceiling from birth.
  assert.ok(covered("/store/carts", "POST") > 0, "carts");
  assert.ok(covered("/store/siumora/anything-added-tomorrow", "POST") > 0, "namespace catch-all");
});

/* -------------------------------------------------------------------------- *
 * Middleware level — the handler src/api/middlewares.ts mounts, driven with
 * fake express request/response objects. No framework boot involved.
 * -------------------------------------------------------------------------- */

interface Sent {
  status?: number;
  body?: unknown;
  headers: Record<string, string>;
}

function fakeExchange(over: Partial<LimiterRequest> = {}) {
  const req: LimiterRequest = {
    method: "POST",
    url: "/auth/customer/otp",
    originalUrl: "/auth/customer/otp",
    ip: "1.1.1.1",
    ...over,
  };
  const sent: Sent = { headers: {} };
  const res: LimiterResponse = {
    setHeader(name, value) {
      sent.headers[name] = value;
    },
    status(code) {
      sent.status = code;
      return {
        json(body: unknown) {
          sent.body = body;
        },
      };
    },
  };
  let nextCalls = 0;
  const next = () => {
    nextCalls += 1;
  };
  return { req, res, sent, next, calls: () => nextCalls };
}

test("middleware passes allowed requests through and refuses the burst with the Fastify envelope", () => {
  const handler = rateLimitMiddleware(createRateLimiter(RULES));

  for (let n = 0; n < 3; n += 1) {
    const x = fakeExchange();
    handler(x.req, x.res, x.next);
    assert.equal(x.calls(), 1, `request ${n} should fall through`);
    assert.equal(x.sent.status, undefined);
  }

  const refused = fakeExchange();
  handler(refused.req, refused.res, refused.next);
  assert.equal(refused.calls(), 0);
  assert.equal(refused.sent.status, 429);
  // The exact envelope apps/api sends, so the SDK's ApiError surfaces
  // identically on either backend.
  assert.deepEqual(refused.sent.body, {
    error: "rate_limited",
    message: "Too many requests. Try again shortly.",
    retryAfterSeconds: 60,
  });
  assert.equal(refused.sent.headers["Retry-After"], "60");
});

test("middleware lets a CORS pre-flight pass uncounted", () => {
  // Throttling the pre-flight breaks the actual request behind it.
  const handler = rateLimitMiddleware(createRateLimiter(RULES));
  for (let n = 0; n < 20; n += 1) {
    const x = fakeExchange({ method: "OPTIONS" });
    handler(x.req, x.res, x.next);
    assert.equal(x.calls(), 1);
  }
  // The OPTIONS storm consumed none of the POST budget.
  const post = fakeExchange();
  handler(post.req, post.res, post.next);
  assert.equal(post.calls(), 1);
});

test("middleware matches on originalUrl, which express mounting does not strip", () => {
  // Mounted via app.use("/auth", ...), express hands the handler a req.url
  // with the mount point removed. Matching on that would miss every rule.
  const handler = rateLimitMiddleware(createRateLimiter(RULES));
  for (let n = 0; n < 4; n += 1) {
    const x = fakeExchange({ url: "/customer/otp", originalUrl: "/auth/customer/otp" });
    handler(x.req, x.res, x.next);
  }
  const refused = fakeExchange({ url: "/customer/otp", originalUrl: "/auth/customer/otp" });
  handler(refused.req, refused.res, refused.next);
  assert.equal(refused.sent.status, 429);
});

test("middleware strips the query string before matching", () => {
  const handler = rateLimitMiddleware(createRateLimiter(DEFAULT_RULES));
  const x = fakeExchange({
    method: "GET",
    originalUrl: "/store/siumora/orders/SIU-00001?accessKey=abc",
    url: "/store/siumora/orders/SIU-00001?accessKey=abc",
  });
  handler(x.req, x.res, x.next);
  assert.equal(x.calls(), 1);
  // One request against the 60/min orders budget, so 59 remain — proven by
  // the limiter seeing the clean path, not the query-carrying one.
  const limiter = createRateLimiter(DEFAULT_RULES);
  const clean = limiter.check("1.1.1.1", "/store/siumora/orders/SIU-00001", "GET");
  assert.equal(clean.remaining, 59);
});

/* -------------------------------------------------------------------------- *
 * Boot level — the DISABLE_RATE_LIMITS escape hatch.
 * -------------------------------------------------------------------------- */

test("disabled rate limits refuse to boot in production", () => {
  assert.throws(
    () => limiterFromEnv({ APP_ENV: "production", DISABLE_RATE_LIMITS: "true" }),
    /DISABLE_RATE_LIMITS must not be set in production/,
  );
});

test("disabled rate limits outside production yield a limiter that refuses nothing", () => {
  // E2E only: the whole suite arrives from 127.0.0.1 in seconds, which is
  // exactly what the shipped limits exist to refuse.
  const limiter = limiterFromEnv({ APP_ENV: "development", DISABLE_RATE_LIMITS: "true" });
  for (let n = 0; n < 100; n += 1) {
    assert.equal(limiter.check("127.0.0.1", "/auth/customer/otp", "POST").allowed, true);
  }
});

test("without the escape hatch every environment gets the shipped rules", () => {
  const limiter = limiterFromEnv({ APP_ENV: "production" });
  let refused = false;
  for (let n = 0; n < 20; n += 1) {
    if (!limiter.check("1.1.1.1", "/auth/customer/otp", "POST").allowed) refused = true;
  }
  assert.equal(refused, true);
});
