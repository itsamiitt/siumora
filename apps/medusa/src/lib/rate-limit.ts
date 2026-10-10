/**
 * Per-origin rate limits — the Medusa port of `apps/api/src/lib/rate-limit.ts`.
 *
 * PORTED, NOT SHARED. apps/api may not grow a build step for this, so the core
 * algorithm below is a copy of the Fastify limiter's. The two files evolve
 * together until M5 archives the Fastify stack; the parity checklist
 * (docs/medusa-parity-checklist.md, "API lib — providers, rate limit, boot
 * guards") carries the 9 behaviors that keep them honest. If you change a rule
 * or the window arithmetic here, change it there — and vice versa.
 *
 * What is preserved from the source file:
 *
 * - Fixed windows rather than a token bucket. The thing defended against is a
 *   script in a loop, and against a script in a loop the difference is nil
 *   while the extra state is not.
 * - The in-process limiter is per instance: two containers mean twice the
 *   ceiling, and a restart forgets every window. With MEDUSA_REDIS_URL set
 *   (required in production — src/boot-guards.ts) {@link limiterFromEnv}
 *   builds {@link createRedisRateLimiter} instead: same rules, same window
 *   arithmetic, one shared counter per bucket, and the in-process limiter as
 *   the fallback while Redis is unreachable.
 * - Keyed by client IP at this layer. The OTP endpoints additionally throttle
 *   by phone number against the database — that limit is about a specific
 *   abuse and lives there, not here.
 * - The DISABLE_RATE_LIMITS escape hatch (E2E only), refused at boot in
 *   production — see {@link limiterFromEnv}.
 *
 * One deliberate divergence: Medusa's express app sets `trust proxy` to 1
 * unconditionally (the Fastify app gated it behind TRUST_PROXY), so `req.ip`
 * is already the client behind one proxy hop.
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
 * The rules, most specific first — the Fastify DEFAULT_RULES re-shaped onto
 * Medusa's route tree. Same classes, same windows, same limits:
 *
 *   Fastify `/auth/*` POST 10/min    → Medusa `/auth/*` POST (strictest; the
 *                                      OTP flow lives under Medusa auth)
 *   Fastify `/checkout` POST 12/min  → Medusa `/store/siumora/checkout` POST
 *   Fastify `/orders/` any 60/min    → Medusa `/store/siumora/orders/` any
 *   Fastify `/products` GET 120/min  → Medusa `/store/products` GET
 *
 * Two additions beyond strict parity, both in the loose browse tier:
 * `/store/carts` (cart building is a burst of POSTs from one customer — the
 * Fastify stack kept carts client-side so it had no such class) and a
 * `/store/siumora/` catch-all so a route landing in the custom namespace
 * tomorrow is born with a ceiling instead of none.
 */
export const DEFAULT_RULES: readonly RateRule[] = [
  // Sign-in. The database limits per phone and per origin over an hour; this
  // is the short-window ceiling that stops a burst before it gets there.
  { prefix: "/auth/", method: "POST", limit: 10, windowMs: 60_000, bucket: "auth" },
  // The send-a-code step lives outside /auth (the built-in route cannot
  // answer with the challenge payload — see its route.ts), but it is the
  // costlier half: every hit is a paid WhatsApp/SMS message. Same bucket as
  // the verify step, exactly as the Fastify /auth/* rule covers both.
  { prefix: "/store/siumora-auth/", method: "POST", limit: 10, windowMs: 60_000, bucket: "auth" },
  // Session reads (who am I, my devices) — browse tier, so a page render
  // that asks twice never trips the sign-in ceiling above.
  { prefix: "/store/siumora-auth/", limit: 120, windowMs: 60_000, bucket: "auth-read" },
  // Each checkout allocates an invoice number under a table lock, so a flood
  // here is contention on the hottest lock in the system.
  { prefix: "/store/siumora/checkout", method: "POST", limit: 12, windowMs: 60_000, bucket: "checkout" },
  // Guessing an order access key. The key is a uuid so guessing is hopeless,
  // but a hopeless attempt still costs a query each time.
  { prefix: "/store/siumora/orders/", limit: 60, windowMs: 60_000, bucket: "orders" },
  // Anything else in the custom namespace lands here: browse-tier ceiling for
  // routes that do not exist yet. Ordered after the specific rules above.
  { prefix: "/store/siumora/", limit: 120, windowMs: 60_000, bucket: "siumora" },
  // Search runs the Hinglish expansion over the catalogue on every call.
  { prefix: "/store/products", method: "GET", limit: 120, windowMs: 60_000, bucket: "products" },
  // Cart building — a customer adds a handful of items; a script adds hundreds.
  { prefix: "/store/carts", limit: 120, windowMs: 60_000, bucket: "carts" },
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

      const bucketKey = bucketKeyFor(key, rule);
      const existing = windows.get(bucketKey);

      if (!existing || existing.resetAt <= now) {
        windows.set(bucketKey, { count: 1, resetAt: now + rule.windowMs });
        return decide(rule, 1, now + rule.windowMs, now);
      }

      existing.count += 1;
      return decide(rule, existing.count, existing.resetAt, now);
    },
    sweep,
    get size() {
      return windows.size;
    },
  };
}

function bucketKeyFor(key: string, rule: RateRule): string {
  return `${key}:${rule.bucket ?? rule.prefix}`;
}

/**
 * The window arithmetic both limiters share: the count is this request's
 * position in its window (1 = it opened the window), resetAt is when the
 * window rolls over.
 */
function decide(
  rule: RateRule,
  count: number,
  resetAt: number,
  now: number,
): RateDecision {
  if (count <= 1) {
    return {
      allowed: true,
      remaining: rule.limit - 1,
      retryAfterSeconds: Math.ceil(rule.windowMs / 1000),
    };
  }
  return {
    allowed: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
}

/* -------------------------------------------------------------------------- *
 * The shared limiter — Redis.
 * -------------------------------------------------------------------------- */

/**
 * The one ioredis call this file makes, typed structurally so the tests can
 * hand in a fake and this file still imports nothing at runtime.
 */
export interface RedisEvalClient {
  eval(
    script: string,
    numKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
}

/**
 * One round trip, atomic: count the hit, open the window on the first one,
 * report the window's remaining life. The PTTL < 0 arm repairs a key that
 * somehow lost its expiry (a crash between INCR and PEXPIRE cannot happen
 * inside a script, but a manual SET could) — a key without a TTL would
 * refuse that origin forever.
 */
export const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export const REDIS_KEY_PREFIX = "siumora:rl:";

export interface AsyncRateLimiter {
  check(key: string, path: string, method: string, now?: number): Promise<RateDecision>;
}

export interface RedisRateLimiterOptions {
  readonly rules?: readonly RateRule[];
  /**
   * Answers while Redis is unreachable — per-instance limits beat none, and
   * beat refusing every checkout because a cache is down.
   */
  readonly fallback?: RateLimiter;
  readonly onError?: (error: unknown) => void;
}

/**
 * The limiter production runs: every Medusa instance counts into the same
 * Redis key per origin and bucket, so the ceiling is the rule's limit however
 * many processes serve the site, and a restart forgets nothing.
 */
export function createRedisRateLimiter(
  client: RedisEvalClient,
  options: RedisRateLimiterOptions = {},
): AsyncRateLimiter {
  const rules = options.rules ?? DEFAULT_RULES;
  const fallback = options.fallback ?? createRateLimiter(rules);

  return {
    async check(key, path, method, now = Date.now()) {
      const rule = ruleFor(rules, path, method);
      if (!rule) return { allowed: true, remaining: Infinity, retryAfterSeconds: 0 };

      try {
        const reply = await client.eval(
          HIT_SCRIPT,
          1,
          `${REDIS_KEY_PREFIX}${bucketKeyFor(key, rule)}`,
          rule.windowMs,
        );
        const [count, ttlMs] = parseHitReply(reply);
        return decide(rule, count, now + ttlMs, now);
      } catch (error) {
        options.onError?.(error);
        return fallback.check(key, path, method, now);
      }
    },
  };
}

function parseHitReply(reply: unknown): [number, number] {
  if (Array.isArray(reply) && reply.length === 2) {
    const count = Number(reply[0]);
    const ttlMs = Number(reply[1]);
    if (Number.isInteger(count) && count > 0 && Number.isFinite(ttlMs)) {
      return [count, Math.max(0, ttlMs)];
    }
  }
  throw new Error(`unexpected rate-limit reply from Redis: ${JSON.stringify(reply)}`);
}

/**
 * The first rule that matches.
 *
 * Order is significant and the list is written most specific first, so
 * `/store/siumora/` does not swallow the rule meant for
 * `/store/siumora/checkout`.
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

/* -------------------------------------------------------------------------- *
 * Boot-time construction — the DISABLE_RATE_LIMITS escape hatch.
 * -------------------------------------------------------------------------- */

export interface RateLimitEnv {
  APP_ENV?: string;
  DISABLE_RATE_LIMITS?: string;
  MEDUSA_REDIS_URL?: string;
}

export interface LimiterDeps {
  /** Builds the Redis client when MEDUSA_REDIS_URL is set. */
  readonly connectRedis?: (url: string) => RedisEvalClient;
  readonly onRedisError?: (error: unknown) => void;
}

/**
 * Build the limiter the middleware file installs, honoring the same escape
 * hatch as the Fastify stack: DISABLE_RATE_LIMITS=true swaps in an empty rule
 * set (E2E only — the whole suite arrives from 127.0.0.1 in seconds, which is
 * exactly what the shipped limits exist to refuse).
 *
 * Refused in production with the Fastify boot guard's exact message. This
 * runs while Medusa loads `src/api/middlewares.ts` — i.e. at boot, before the
 * server listens — so the semantics match apps/api's assertBootSafety: the
 * process never comes up limitless in production. APP_ENV itself (not
 * NODE_ENV — see src/boot-guards.ts) has already been validated by the config
 * loader, which runs before the API loader.
 */
export function limiterFromEnv(env?: RateLimitEnv): RateLimiter;
export function limiterFromEnv(
  env: RateLimitEnv,
  deps: LimiterDeps,
): RateLimiter | AsyncRateLimiter;
export function limiterFromEnv(
  env: RateLimitEnv = process.env,
  deps: LimiterDeps = {},
): RateLimiter | AsyncRateLimiter {
  const disabled = env.DISABLE_RATE_LIMITS === "true";
  const appEnv = env.APP_ENV ?? "development";
  if (disabled && appEnv === "production") {
    // The limiter is what stands between the OTP endpoint and a phone-number
    // enumeration; an unlimited production API is not a faster API, it is an
    // open one.
    throw new Error("DISABLE_RATE_LIMITS must not be set in production.");
  }
  if (disabled) return createRateLimiter([]);

  // Shared counters wherever Redis exists (production always — the boot
  // guard refuses to start without it); development without Redis keeps
  // the in-process limiter, which is all one local process needs.
  if (env.MEDUSA_REDIS_URL && deps.connectRedis) {
    return createRedisRateLimiter(deps.connectRedis(env.MEDUSA_REDIS_URL), {
      onError: deps.onRedisError,
    });
  }
  return createRateLimiter();
}

/* -------------------------------------------------------------------------- *
 * The express middleware.
 * -------------------------------------------------------------------------- */

/**
 * Structural slices of express's Request/Response — just what the limiter
 * touches. Typed structurally rather than as MedusaRequest/MedusaResponse so
 * this file imports nothing from @medusajs/* and stays runnable under
 * `node --test --experimental-strip-types` without booting the framework.
 * `src/api/middlewares.ts` passes the real Medusa types through these shapes;
 * the compiler checks the fit there.
 */
export interface LimiterRequest {
  method: string;
  /** The full path. Express keeps it here even under a mounted middleware. */
  originalUrl?: string;
  url: string;
  ip?: string;
  socket?: { remoteAddress?: string };
}

export interface LimiterResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): { json(body: unknown): unknown };
}

export type LimiterNext = (err?: unknown) => void;

/**
 * The handler `src/api/middlewares.ts` mounts. Mirrors the Fastify onRequest
 * hook: pre-flights pass (CORS answers them; throttling a pre-flight breaks
 * the actual request behind it), allowed requests fall through, refusals get
 * Retry-After and the exact envelope the Fastify limiter sends — so the SDK's
 * ApiError surfaces identically on either backend:
 *
 *   429 { error: "rate_limited", message: "...", retryAfterSeconds: n }
 *
 * Matching runs on `req.originalUrl`, not `req.url`: middlewares registered
 * without `methods` are mounted via `app.use(matcher, ...)`, and express
 * strips the mount point from `req.url` inside a mounted handler.
 */
export function rateLimitMiddleware(limiter: RateLimiter | AsyncRateLimiter) {
  return function rateLimit(
    req: LimiterRequest,
    res: LimiterResponse,
    next: LimiterNext,
  ): void {
    if (req.method === "OPTIONS") return next();

    const url = req.originalUrl ?? req.url;
    const path = url.split("?")[0] ?? url;
    const key = req.ip ?? req.socket?.remoteAddress ?? "unknown";

    const answer = (decision: RateDecision): void => {
      if (decision.allowed) return next();

      res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      res.status(429).json({
        error: "rate_limited",
        message: "Too many requests. Try again shortly.",
        retryAfterSeconds: decision.retryAfterSeconds,
      });
    };

    const decision = limiter.check(key, path, req.method);
    // The in-process limiter answers synchronously and is answered the same
    // way; the Redis limiter's promise never rejects (it falls back), but a
    // limiter fault must not hang the request, so a rejection lets it pass.
    if (decision instanceof Promise) {
      decision.then(answer, () => next());
    } else {
      answer(decision);
    }
  };
}
