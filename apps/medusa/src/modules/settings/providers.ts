import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { OPTIONAL_FIELDS, PROVIDERS, type ProviderName } from "./provider-fields.ts";
import type { WriteSqlClient } from "./write";

type Env = Record<string, string | undefined>;
type StoredProvider = { enabled: boolean; fields: Record<string, string> };
const prefix = "integration_";

function encryptionKey(env: Env): Buffer {
  const key = env.SETTINGS_ENCRYPTION_KEY;
  if (!key || key.length < 32) throw new Error("Set SETTINGS_ENCRYPTION_KEY to a random secret of at least 32 characters before editing providers.");
  return createHash("sha256").update(key).digest();
}

function encrypt(value: StoredProvider, provider: ProviderName, env: Env): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(env), iv);
  cipher.setAAD(Buffer.from(provider));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

function decrypt(value: unknown, provider: ProviderName, env: Env): StoredProvider {
  try {
    if (typeof value !== "string") throw new Error();
    const [version, iv, tag, data] = value.split(".");
    if (version !== "v1" || !iv || !tag || !data) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", encryptionKey(env), Buffer.from(iv, "base64url"));
    cipher.setAAD(Buffer.from(provider));
    cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data, "base64url")), cipher.final()]).toString("utf8"));
  } catch { throw new Error(`Cannot decrypt ${provider} settings. Restore the original SETTINGS_ENCRYPTION_KEY.`); }
}

type SettingsReadPg = { raw(sql: string): Promise<{ rows: unknown[] }> };
type Decoded = Record<ProviderName, { saved: boolean; stored?: StoredProvider; error?: string }>;

/**
 * Decrypted provider rows, per process, for 30s (the settings cache's TTL).
 * This runs on every payment/courier/OTP call; the cache saves a query and
 * up to one AES-GCM open per provider each time. Only the process.env path
 * is cached (tests pass their own env), saveProvider clears it on this
 * instance, and other instances converge within the TTL. Keyed per pg client
 * so two containers never share an entry.
 */
const DECODED_TTL_MS = 30_000;
let decodedCache = new WeakMap<object, { at: number; decoded: Decoded }>();

/** The write path is done (or the key rotated): re-read on the next call. */
export function invalidateProviderCache(): void {
  decodedCache = new WeakMap();
}

async function decodeRows(pg: SettingsReadPg, env: Env): Promise<Decoded> {
  const cacheable = env === process.env;
  const hit = cacheable ? decodedCache.get(pg) : undefined;
  if (hit && Date.now() - hit.at < DECODED_TTL_MS) return hit.decoded;
  const rows = (await pg.raw("SELECT key, value FROM siumora_settings WHERE key LIKE 'integration_%'")).rows as { key: string; value: unknown }[];
  const decoded = {} as Decoded;
  for (const name of Object.keys(PROVIDERS) as ProviderName[]) {
    const row = rows.find((row) => row.key === prefix + name);
    if (!row) { decoded[name] = { saved: false }; continue; }
    try { decoded[name] = { saved: true, stored: decrypt(row.value, name, env) }; }
    catch (e) {
      // Still disabled (never silently fall back to env credentials the
      // owner may have replaced), but loudly: a rotated or missing
      // SETTINGS_ENCRYPTION_KEY turns prepaid and couriers off store-wide.
      console.error(`[money-alert] provider settings could not be decrypted (provider: ${name}) — it is disabled until SETTINGS_ENCRYPTION_KEY is restored`);
      decoded[name] = { saved: true, error: (e as Error).message };
    }
  }
  if (cacheable) decodedCache.set(pg, { at: Date.now(), decoded });
  return decoded;
}

export async function providerConfiguration(pg: SettingsReadPg, env: Env = process.env) {
  const decoded = await decodeRows(pg, env);
  const effective: Env = { ...env };
  const providers = {} as Record<ProviderName, { enabled: boolean; configured: boolean; saved: boolean; fields: Record<string, boolean>; error?: string }>;
  for (const name of Object.keys(PROVIDERS) as ProviderName[]) {
    const { stored, error, saved } = decoded[name];
    const enabled = !error && (stored?.enabled ?? true);
    const fields: Record<string, boolean> = {};
    for (const field of PROVIDERS[name].fields) {
      const value = stored?.fields[field] ?? env[field];
      fields[field] = Boolean(value);
      effective[field] = enabled ? value : undefined;
    }
    const required = PROVIDERS[name].fields.filter((field) => !OPTIONAL_FIELDS.has(field));
    providers[name] = { enabled, configured: enabled && required.every((key) => fields[key]), saved, fields, ...(error ? { error } : {}) };
  }
  return { effective, providers, editable: Boolean(env.SETTINGS_ENCRYPTION_KEY && env.SETTINGS_ENCRYPTION_KEY.length >= 32) };
}

export async function saveProvider(pg: WriteSqlClient, name: ProviderName, input: unknown, env: Env = process.env): Promise<void> {
  if (!input || typeof input !== "object") throw new Error("Expected provider settings.");
  const body = input as { enabled?: unknown; fields?: unknown };
  if (typeof body.enabled !== "boolean" || !body.fields || typeof body.fields !== "object" || Array.isArray(body.fields)) throw new Error("Expected enabled and fields.");
  const allowed: readonly string[] = PROVIDERS[name].fields;
  const updates = body.fields as Record<string, unknown>;
  for (const [key, value] of Object.entries(updates)) {
    if (!allowed.includes(key) || typeof value !== "string" || value.length > 4096 || /[\r\n\u0000]/.test(value)) throw new Error("Invalid provider field.");
    if (key === "WHATSAPP_BSP_URL" && value) {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("WhatsApp BSP URL must use HTTPS without credentials in the URL.");
    }
    if (key === "EMAIL_FROM" && value && !/^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/.test(value) && !/^[^<>]+<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$/.test(value)) throw new Error("Enter a valid sender email address.");
  }
  invalidateProviderCache();
  const { effective } = await providerConfiguration(pg, env);
  // Read stored values separately so disabling a provider never erases its credentials.
  const rows = (await pg.raw("SELECT key, value FROM siumora_settings WHERE key = ?", [prefix + name])).rows;
  const previous = rows[0] ? decrypt(rows[0].value, name, env).fields : {};
  const fields: Record<string, string> = {};
  for (const key of allowed) fields[key] = typeof updates[key] === "string" ? (updates[key] as string).trim() : previous[key] ?? effective[key] ?? "";
  const sealed = encrypt({ enabled: body.enabled, fields }, name, env);
  await pg.raw(`INSERT INTO siumora_settings (key, value, created_at, updated_at) VALUES (?, ?::jsonb, now(), now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [prefix + name, JSON.stringify(sealed)]);
  invalidateProviderCache();
}
