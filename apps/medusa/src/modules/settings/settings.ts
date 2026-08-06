/**
 * Pure settings logic — no Medusa imports, so node --test can strip-type it
 * (same convention as siumora-order/identity.ts). Everything the config
 * route decides that is worth a unit test lives here; the route stays thin
 * I/O.
 *
 * This is the Medusa port of packages/db/src/settings-repository.ts: the
 * table (siumora_settings) is a dumb key/value store on purpose, and
 * everything that makes it safe lives in the application — the closed key
 * registry, the per-key validation, and the defaults. A bad value that
 * somehow got stored is ignored at the read in favour of the default, so a
 * corrupted row can degrade the dial but never crash the storefront.
 *
 * The values are MIRRORED from settings-repository.ts rather than imported:
 * @siumora/db is not (and must not become) a dependency of this app — its
 * schema half is the Fastify stack's. The mirror is kept honest by comments
 * pointing at the source; the recorded SDK contract
 * (apps/api/src/sdk-contract.test.ts, getStoreConfig) pins the public
 * envelope both stacks serve.
 */

export interface Settings {
  /**
   * The kill-switch. False = checkout refuses and the storefront renders the
   * paused state; everything else keeps serving.
   */
  readonly paymentsEnabled: boolean;
  /** COD order-value cap in paise. Launch cap ₹5,000 (eng review, plan W1). */
  readonly codMaxOrder: number;
  /** COD handling fee in paise. */
  readonly codFee: number;
  /** COD floor in paise — below this the fee exceeds the margin. */
  readonly codMinOrder: number;
}

/**
 * Same values as packages/db/src/settings-repository.ts SETTING_DEFAULTS.
 * Defaults live in code, not in seeded rows — an empty table means "payments
 * enabled, launch COD caps", exactly as it does on the Fastify side. The
 * migration therefore seeds nothing.
 */
export const SETTING_DEFAULTS: Settings = {
  paymentsEnabled: true,
  codMaxOrder: 500000,
  codFee: 4900,
  codMinOrder: 49900,
};

export type SettingKey =
  | "payments_enabled"
  | "cod_max_order"
  | "cod_fee"
  | "cod_min_order";

interface SettingDefinition {
  readonly prop: keyof Settings;
  readonly validate: (value: unknown) => boolean;
}

/** Paise sanity ceiling: ₹1,00,000. A cap above that is a typo, not a policy. */
const PAISE_CEILING = 10_000_000;

function isPaise(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= PAISE_CEILING
  );
}

const DEFINITIONS: Record<SettingKey, SettingDefinition> = {
  payments_enabled: {
    prop: "paymentsEnabled",
    validate: (value) => typeof value === "boolean",
  },
  cod_max_order: { prop: "codMaxOrder", validate: isPaise },
  cod_fee: { prop: "codFee", validate: isPaise },
  cod_min_order: { prop: "codMinOrder", validate: isPaise },
};

export function isSettingKey(value: string): value is SettingKey {
  return value in DEFINITIONS;
}

/** One row of the siumora_settings table, as the raw SQL read returns it. */
export interface SettingRow {
  readonly key: string;
  readonly value: unknown;
}

/**
 * Stored rows merged over the defaults — the same recipe as the Fastify
 * readSettings: an unknown key or a wrong-shaped value is skipped, never
 * served and never fatal.
 */
export function mergeSettings(rows: ReadonlyArray<SettingRow>): Settings {
  const merged: Record<keyof Settings, Settings[keyof Settings]> = {
    ...SETTING_DEFAULTS,
  };
  for (const row of rows) {
    if (!isSettingKey(row.key)) continue;
    const definition = DEFINITIONS[row.key];
    if (!definition.validate(row.value)) continue;
    merged[definition.prop] = row.value as Settings[keyof Settings];
  }
  return merged as Settings;
}

/**
 * Whether a payment provider is wired up at all — the storefront tells the
 * truth about money either way, and this is which truth.
 *
 * The Fastify app builds its Razorpay client when RAZORPAY_KEY_ID and
 * RAZORPAY_KEY_SECRET are both present (apps/api/src/server.ts →
 * app.ts's `config.razorpayKeyId && config.razorpayKeySecret`), and
 * /config reports `server.payments !== undefined`. Same envs, same truth,
 * without building a client this app does not use yet (the client itself is
 * the M3 Razorpay provider port).
 */
export function razorpayConfigured(
  env: Record<string, string | undefined>,
): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

/**
 * The public /config envelope — exactly the two keys the recorded contract
 * pins (sdk-contract.test.ts assertExactKeys ["paymentsEnabled",
 * "razorpayConfigured"]). The COD caps stay private: they are checkout
 * inputs, not storefront flags, and the Fastify /config does not leak them
 * either.
 */
export function configEnvelope(
  settings: Settings,
  env: Record<string, string | undefined>,
): { paymentsEnabled: boolean; razorpayConfigured: boolean } {
  return {
    paymentsEnabled: settings.paymentsEnabled,
    razorpayConfigured: razorpayConfigured(env),
  };
}

/**
 * Cached settings reader — the Medusa twin of apps/api/src/lib/settings.ts.
 *
 * Same TTL, same shape, same reasoning: a database round-trip per request
 * for four values that change weekly is waste, and the TTL bounds staleness
 * across instances at the kill-switch drill's "within 30 seconds" window.
 * There is no admin write path on this stack yet (M2 ops routes), so there
 * is no invalidate() caller — but the method exists so the write path lands
 * against the same reader the Fastify one has.
 */
export interface SettingsReader {
  get(): Promise<Settings>;
  invalidate(): void;
}

export const SETTINGS_TTL_MS = 30_000;

export function createSettingsCache(
  load: () => Promise<Settings>,
  ttlMs: number = SETTINGS_TTL_MS,
  now: () => number = Date.now,
): SettingsReader {
  let cached: Settings | undefined;
  let fetchedAt = 0;

  return {
    async get(): Promise<Settings> {
      const at = now();
      if (cached && at - fetchedAt < ttlMs) return cached;
      cached = await load();
      fetchedAt = at;
      return cached;
    },
    invalidate(): void {
      cached = undefined;
      fetchedAt = 0;
    },
  };
}
