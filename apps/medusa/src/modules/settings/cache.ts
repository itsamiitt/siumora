import { createSettingsCache, type Settings, type SettingsReader } from "./settings";

/**
 * The one settings cache per process — previously a module-level variable in
 * the config route, moved here so the M2 admin settings PATCH can invalidate
 * the same instance the storefront /config read serves from (the Fastify
 * server.settings decoration, in module form). Same 30s TTL, same reasoning
 * (settings.ts createSettingsCache).
 */

let cache: SettingsReader | undefined;

export function settingsCache(load: () => Promise<Settings>): SettingsReader {
  cache ??= createSettingsCache(load);
  return cache;
}

/** The write path is done; make this instance see it immediately. */
export function invalidateSettingsCache(): void {
  cache?.invalidate();
}
