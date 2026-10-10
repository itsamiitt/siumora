import Redis from "ioredis";

import { createMemoryCounters, createRedisCounters, type Counters } from "./counters";

/**
 * The one Redis connection this app opens for itself (Medusa's own modules
 * open theirs): the rate limiter and the sign-in caps share it. Built
 * lazily from MEDUSA_REDIS_URL — required in production (boot-guards.ts) —
 * and absent in development, where everything falls back to in-process
 * counters.
 */

/** One Redis complaint a minute is a signal; one per request is a flood. */
const REDIS_ERROR_LOG_INTERVAL_MS = 60_000;
let lastRedisErrorLoggedAt = 0;

export function logRedisError(error: unknown): void {
  const now = Date.now();
  if (now - lastRedisErrorLoggedAt < REDIS_ERROR_LOG_INTERVAL_MS) return;
  lastRedisErrorLoggedAt = now;
  console.error(
    "Redis unreachable, using per-instance limits:",
    error instanceof Error ? error.message : error,
  );
}

export function connectRedis(url: string): Redis {
  // No offline queue and one retry: while Redis is unreachable a check
  // fails fast and the caller falls back to its in-process twin, rather
  // than holding the request until Redis returns.
  const client = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  // Without a listener ioredis reports every failed reconnect as an
  // unhandled error event; the throttled log is the one signal we want.
  client.on("error", logRedisError);
  return client;
}

const globalForRedis = globalThis as typeof globalThis & {
  __siumoraRedis?: Redis | null;
  __siumoraCounters?: Counters;
};

export function sharedRedis(env: Record<string, string | undefined> = process.env): Redis | null {
  if (globalForRedis.__siumoraRedis === undefined) {
    globalForRedis.__siumoraRedis = env.MEDUSA_REDIS_URL ? connectRedis(env.MEDUSA_REDIS_URL) : null;
  }
  return globalForRedis.__siumoraRedis;
}

/** The sign-in caps' counters: shared through Redis when it exists. */
export function sharedCounters(): Counters {
  if (!globalForRedis.__siumoraCounters) {
    const redis = sharedRedis();
    globalForRedis.__siumoraCounters = redis
      ? createRedisCounters(redis, { onError: logRedisError })
      : createMemoryCounters();
  }
  return globalForRedis.__siumoraCounters;
}
