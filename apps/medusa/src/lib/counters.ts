import { HIT_SCRIPT, type RedisEvalClient } from "./rate-limit.ts";

/**
 * Named fixed-window counters for the sign-in abuse caps (auth plan phase 1):
 * codes per origin per hour, codes per number per day, and the global daily
 * SMS budget. Same window arithmetic and Lua script as the rate limiter
 * (rate-limit.ts HIT_SCRIPT), but keyed by whatever the caller names rather
 * than by path rule — these caps are about a phone number or a spend, not a
 * route.
 *
 * Redis when it is reachable (one count across every process), an
 * in-process map when it is not — a cap that forgets on restart beats no
 * cap, and beats refusing every sign-in because a cache is down.
 */

export const COUNTER_KEY_PREFIX = "siumora:cap:";

export interface CounterHit {
  readonly count: number;
  /** Epoch ms when this window rolls over. */
  readonly resetAt: number;
}

export interface Counters {
  hit(key: string, windowMs: number, now?: number): Promise<CounterHit>;
}

export function createMemoryCounters(): Counters & { readonly size: number } {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    async hit(key, windowMs, now = Date.now()) {
      if (windows.size > 10_000) {
        for (const [name, window] of windows) if (window.resetAt <= now) windows.delete(name);
      }
      const existing = windows.get(key);
      if (!existing || existing.resetAt <= now) {
        const fresh = { count: 1, resetAt: now + windowMs };
        windows.set(key, fresh);
        return { ...fresh };
      }
      existing.count += 1;
      return { count: existing.count, resetAt: existing.resetAt };
    },
    get size() {
      return windows.size;
    },
  };
}

export function createRedisCounters(
  client: RedisEvalClient,
  options: { fallback?: Counters; onError?: (error: unknown) => void } = {},
): Counters {
  const fallback = options.fallback ?? createMemoryCounters();
  return {
    async hit(key, windowMs, now = Date.now()) {
      try {
        const reply = await client.eval(HIT_SCRIPT, 1, `${COUNTER_KEY_PREFIX}${key}`, windowMs);
        if (Array.isArray(reply) && reply.length === 2) {
          const count = Number(reply[0]);
          const ttl = Number(reply[1]);
          if (Number.isInteger(count) && count > 0 && Number.isFinite(ttl)) {
            return { count, resetAt: now + Math.max(0, ttl) };
          }
        }
        throw new Error(`unexpected counter reply from Redis: ${JSON.stringify(reply)}`);
      } catch (error) {
        options.onError?.(error);
        return fallback.hit(key, windowMs, now);
      }
    },
  };
}

export interface CapDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

/** Count a hit against a cap. A limit of 0 refuses everything. */
export async function underCap(
  counters: Counters,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<CapDecision> {
  const hit = await counters.hit(key, windowMs, now);
  return {
    allowed: hit.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((hit.resetAt - now) / 1000)),
  };
}
