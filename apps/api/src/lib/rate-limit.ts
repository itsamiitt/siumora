/**
 * Per-origin rate limits.
 *
 * plan/11 §4 asks for these on auth, checkout and search. The OTP endpoints
 * already throttle by phone number and by origin against the database — those
 * limits are about a specific abuse and they belong there. This is the coarser
 * layer underneath: a bound on how fast any one origin can hit the endpoints
 * that cost money to serve.
 *
 * Fixed windows rather than a token bucket. A token bucket is smoother, but the
 * thing being defended against here is a script in a loop, and against a script
 * in a loop the difference is nil while the extra state is not.
 *
 * **In-process, so the limit is per instance.** Two API containers mean twice
 * the ceiling. That is a real and stated limitation: the shared counter belongs
 * in Redis, which plan/11 §1 already budgets for. Until then this stops the
 * loop, not a distributed flood — and the WAF in front is what stops that.
 */

export interface RateRule {
  /** Matched as a prefix of the pathname. */
  readonly prefix: string;
  readonly method?: string;
  readonly limit: number;
  readonly windowMs: number;
  /** Bucket key, so several paths can share one budget. Defaults to prefix. */
  readonly bucket?: string;
}

/**
 * The rules, most specific first.
 *
 * Numbers chosen to be invisible to a person and obstructive to a script. A
 * customer types one search a second at most and checks out once; nobody
 * legitimately posts thirty orders a minute from one address.
 */
export const DEFAULT_RULES: readonly RateRule[] = [
  // Sign-in. The database limits per phone and per origin over an hour; this
  // is the short-window ceiling that stops a burst before it gets there.
  { prefix: "/auth/", method: "POST", limit: 10, windowMs: 60_000, bucket: "auth" },
  // Each one allocates an invoice number under a table lock, so a flood here
  // is contention on the hottest lock in the system.
  { prefix: "/checkout", method: "POST", limit: 12, windowMs: 60_000 },
  // Search runs the Hinglish expansion over the catalogue on every call.
  { prefix: "/products", method: "GET", limit: 120, windowMs: 60_000 },
  // Guessing an access key. The key is a uuid so guessing is hopeless, but a
  // hopeless attempt still costs a query each time.
  { prefix: "/orders/", limit: 60, windowMs: 60_000 },
];

export interface RateDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  /** Seconds until the window rolls over. Sent as Retry-After on a refusal. */
  readonly retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  check(key: string, path: string, method: string, now?: number): RateDecision;
  /** Drop windows that have already rolled over. */
  sweep(now?: number): number;
  readonly size: number;
}

/** Windows are swept when the map grows past this, so it cannot grow forever. */
const SWEEP_THRESHOLD = 10_000;

export function createRateLimiter(
  rules: readonly RateRule[] = DEFAULT_RULES,
): RateLimiter {
  const windows = new Map<string, Window>();

  function sweep(now = Date.now()): number {
    let dropped = 0;
    for (const [key, window] of windows) {
      if (window.resetAt <= now) {
        windows.delete(key);
        dropped += 1;
      }
    }
    return dropped;
  }

  return {
    check(key, path, method, now = Date.now()) {
      const rule = ruleFor(rules, path, method);
      // An unlisted path is not rate limited. Listing everything would put a
      // ceiling on the health check and the webhook endpoints, where a burst is
      // a courier catching up rather than an attack.
      if (!rule) return { allowed: true, remaining: Infinity, retryAfterSeconds: 0 };

      if (windows.size > SWEEP_THRESHOLD) sweep(now);

      const bucketKey = `${key}:${rule.bucket ?? rule.prefix}`;
      const existing = windows.get(bucketKey);

      if (!existing || existing.resetAt <= now) {
        windows.set(bucketKey, { count: 1, resetAt: now + rule.windowMs });
        return {
          allowed: true,
          remaining: rule.limit - 1,
          retryAfterSeconds: Math.ceil(rule.windowMs / 1000),
        };
      }

      existing.count += 1;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000),
      );

      return {
        allowed: existing.count <= rule.limit,
        remaining: Math.max(0, rule.limit - existing.count),
        retryAfterSeconds,
      };
    },
    sweep,
    get size() {
      return windows.size;
    },
  };
}

/**
 * The first rule that matches.
 *
 * Order is significant and the list is written most specific first, so
 * `/products` does not swallow a rule meant for `/products/:handle/reviews`.
 */
function ruleFor(
  rules: readonly RateRule[],
  path: string,
  method: string,
): RateRule | undefined {
  return rules.find(
    (rule) =>
      path.startsWith(rule.prefix) &&
      (rule.method === undefined || rule.method === method),
  );
}
