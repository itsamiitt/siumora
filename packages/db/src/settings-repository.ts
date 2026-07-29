import { sql } from "drizzle-orm";

import type { Database } from "./client.ts";
import { settings } from "./schema.ts";

/**
 * The typed side of the settings table.
 *
 * The table is a dumb key/value store; everything that makes it safe lives
 * here — the closed key registry, the per-key validation, the defaults, and
 * the one cross-key invariant. An unknown key or a wrong-shaped value is
 * refused at the write, and a bad value that somehow got stored is ignored at
 * the read in favour of the default, so a corrupted row can degrade the dial
 * but never crash checkout.
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
  readonly validate: (value: unknown) => string | undefined;
}

/** Paise sanity ceiling: ₹1,00,000. A cap above that is a typo, not a policy. */
const PAISE_CEILING = 10_000_000;

function paise(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return "must be an integer amount in paise";
  }
  if (value < 0) return "must not be negative";
  if (value > PAISE_CEILING) return `must be at most ${PAISE_CEILING} paise`;
  return undefined;
}

const DEFINITIONS: Record<SettingKey, SettingDefinition> = {
  payments_enabled: {
    prop: "paymentsEnabled",
    validate: (value) =>
      typeof value === "boolean" ? undefined : "must be true or false",
  },
  cod_max_order: { prop: "codMaxOrder", validate: paise },
  cod_fee: { prop: "codFee", validate: paise },
  cod_min_order: { prop: "codMinOrder", validate: paise },
};

export const SETTING_KEYS = Object.keys(DEFINITIONS) as readonly SettingKey[];

export function isSettingKey(value: string): value is SettingKey {
  return value in DEFINITIONS;
}

/** Stored rows merged over the defaults; a malformed stored value is ignored. */
export async function readSettings(db: Database): Promise<Settings> {
  const rows = await db.select().from(settings);

  const merged: Record<keyof Settings, Settings[keyof Settings]> = {
    ...SETTING_DEFAULTS,
  };
  for (const row of rows) {
    if (!isSettingKey(row.key)) continue;
    const definition = DEFINITIONS[row.key];
    if (definition.validate(row.value) !== undefined) continue;
    merged[definition.prop] = row.value as Settings[keyof Settings];
  }

  return merged as Settings;
}

export type UpdateSettingResult =
  | { readonly ok: true; readonly settings: Settings }
  | { readonly ok: false; readonly error: string };

/**
 * Validate and upsert one setting, returning the full merged result.
 *
 * The cross-key invariant is checked against what the table would look like
 * after the write — setting the floor above the cap would make COD silently
 * unavailable at every order value, which is a policy decision nobody made.
 */
export async function updateSetting(
  db: Database,
  key: string,
  value: unknown,
): Promise<UpdateSettingResult> {
  if (!isSettingKey(key)) {
    return { ok: false, error: `unknown setting "${key}"` };
  }

  const definition = DEFINITIONS[key];
  const problem = definition.validate(value);
  if (problem !== undefined) {
    return { ok: false, error: `${key} ${problem}` };
  }

  const current = await readSettings(db);
  const next = { ...current, [definition.prop]: value } as Settings;
  if (next.codMinOrder > next.codMaxOrder) {
    return {
      ok: false,
      error: "cod_min_order must not exceed cod_max_order",
    };
  }

  await db
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: sql`excluded.value`, updatedAt: new Date() },
    });

  return { ok: true, settings: next };
}
