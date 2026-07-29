import { readSettings, type Database, type Settings } from "@siumora/db";

/**
 * Cached settings reader.
 *
 * Checkout reads these on every request; a database round-trip per request
 * for four values that change weekly is waste, so reads are served from an
 * in-process cache with a short TTL. The admin write path calls
 * `invalidate()` so a change is visible on this instance immediately — the
 * TTL only bounds staleness across *other* instances (one at launch), which
 * is why the kill-switch drill's "within 30 seconds" window exists at all.
 */
export interface SettingsReader {
  get(): Promise<Settings>;
  invalidate(): void;
}

export const SETTINGS_TTL_MS = 30_000;

export function createSettingsCache(
  db: Database,
  ttlMs: number = SETTINGS_TTL_MS,
): SettingsReader {
  let cached: Settings | undefined;
  let fetchedAt = 0;

  return {
    async get(): Promise<Settings> {
      const now = Date.now();
      if (cached && now - fetchedAt < ttlMs) return cached;
      cached = await readSettings(db);
      fetchedAt = now;
      return cached;
    },
    invalidate(): void {
      cached = undefined;
      fetchedAt = 0;
    },
  };
}
