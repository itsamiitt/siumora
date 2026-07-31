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
 * - **In-process, so the limit is per instance.** Two containers mean twice
 *   the ceiling. The shared counter belongs in Redis (a TODOS.md trigger, not
 *   now); until then this stops the loop, and the WAF in front stops the flood.
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
export function limiterFromEnv(env: RateLimitEnv = process.env): RateLimiter {
  const disabled = env.DISABLE_RATE_LIMITS === "true";
  const appEnv = env.APP_ENV ?? "development";
  if (disabled && appEnv === "production") {
    // The limiter is what stands between the OTP endpoint and a phone-number
    // enumeration; an unlimited production API is not a faster API, it is an
    // open one.
    throw new Error("DISABLE_RATE_LIMITS must not be set in production.");
  }
  return disabled ? createRateLimiter([]) : createRateLimiter();
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
export function rateLimitMiddleware(limiter: RateLimiter) {
  return function rateLimit(
    req: LimiterRequest,
    res: LimiterResponse,
    next: LimiterNext,
  ): void {
    if (req.method === "OPTIONS") return next();

    const url = req.originalUrl ?? req.url;
    const path = url.split("?")[0] ?? url;
    const key = req.ip ?? req.socket?.remoteAddress ?? "unknown";

    const decision = limiter.check(key, path, req.method);
    if (decision.allowed) return next();

    res.setHeader("Retry-After", String(decision.retryAfterSeconds));
    res.status(429).json({
      error: "rate_limited",
      message: "Too many requests. Try again shortly.",
      retryAfterSeconds: decision.retryAfterSeconds,
    });
  };
}
