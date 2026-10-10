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

// prettier-ignore -- single line so @ts-ignore reaches the specifier
// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { DEFAULT_OTP_POLICY, type OtpPolicy } from "@siumora/core";

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
  /**
   * Phone sign-in limits (core's OtpPolicy), read by the phone-otp auth
   * provider so an operator can tighten them during an attack without a
   * deploy. Medusa-only keys: the Fastify stack keeps its constants.
   */
  readonly otpTtlSeconds: number;
  readonly otpResendCooldownSeconds: number;
  readonly otpMaxSendsPerWindow: number;
  readonly otpSendWindowSeconds: number;
  readonly otpMaxAttempts: number;
  /**
   * Abuse caps above the per-number policy (auth plan phase 1): codes one
   * origin may request per hour across all numbers (the Fastify
   * OTP_MAX_SENDS_PER_IP), codes one number may receive per day, and the
   * day's SMS budget across the whole site — past it, WhatsApp still
   * sends and SMS stops (0 = SMS off).
   */
  readonly otpMaxSendsPerIpHour: number;
  readonly otpMaxSendsPerDay: number;
  readonly otpDailySmsCap: number;
  /** WhatsApp a customer when their account signs in on a new device. */
  readonly newDeviceAlerts: boolean;
  /** COD needs the order phone verified by OTP at checkout (phase 2). */
  readonly codRequiresOtp: boolean;
  /**
   * A COD order above this (paise) to an address the customer has not
   * ordered to before needs a fresh OTP (StepUpGate), not just a session.
   */
  readonly codStepUpAbove: number;
  /** Dashboard users must have two-step sign-in to use the Siumora ops pages. */
  readonly staffMfaRequired: boolean;
  /** Google sign-in offered at all (phase 4), and to what share of shoppers
   *  — the A/B arm against phone-only. */
  readonly googleSignInEnabled: boolean;
  readonly googleSignInPercent: number;
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
  otpTtlSeconds: DEFAULT_OTP_POLICY.ttlSeconds,
  otpResendCooldownSeconds: DEFAULT_OTP_POLICY.resendCooldownSeconds,
  otpMaxSendsPerWindow: DEFAULT_OTP_POLICY.maxSendsPerWindow,
  otpSendWindowSeconds: DEFAULT_OTP_POLICY.sendWindowSeconds,
  otpMaxAttempts: DEFAULT_OTP_POLICY.maxAttempts,
  otpMaxSendsPerIpHour: 20,
  otpMaxSendsPerDay: 10,
  otpDailySmsCap: 1000,
  newDeviceAlerts: true,
  codRequiresOtp: true,
  codStepUpAbove: 300000,
  staffMfaRequired: true,
  googleSignInEnabled: false,
  googleSignInPercent: 50,
};

export type SettingKey =
  | "payments_enabled"
  | "cod_max_order"
  | "cod_fee"
  | "cod_min_order"
  | "otp_ttl_seconds"
  | "otp_resend_cooldown_seconds"
  | "otp_max_sends_per_window"
  | "otp_send_window_seconds"
  | "otp_max_attempts"
  | "otp_max_sends_per_ip_hour"
  | "otp_max_sends_per_day"
  | "otp_daily_sms_cap"
  | "new_device_alerts"
  | "cod_requires_otp"
  | "cod_step_up_above"
  | "staff_mfa_required"
  | "google_signin_enabled"
  | "google_signin_percent";

interface SettingDefinition {
  readonly prop: keyof Settings;
  readonly validate: (value: unknown) => boolean;
  /** What a valid value is, worded for the operator whose write was refused. */
  readonly expected: string;
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

const PAISE_EXPECTED = `expected integer paise between 0 and ${PAISE_CEILING}`;

/**
 * An integer within bounds. The bounds are the safety rails on a lever an
 * operator pulls under pressure: no code that lives past NIST's 10-minute
 * out-of-band ceiling, no zero-attempt lock that refuses every shopper, no
 * cooldown so long that a lost message strands a real customer.
 */
function intBetween(prop: keyof Settings, min: number, max: number): SettingDefinition {
  return {
    prop,
    validate: (value) =>
      typeof value === "number" && Number.isInteger(value) && value >= min && value <= max,
    expected: `expected an integer between ${min} and ${max}`,
  };
}

function bool(prop: keyof Settings): SettingDefinition {
  return { prop, validate: (value) => typeof value === "boolean", expected: "expected a boolean" };
}

const DEFINITIONS: Record<SettingKey, SettingDefinition> = {
  payments_enabled: bool("paymentsEnabled"),
  cod_max_order: { prop: "codMaxOrder", validate: isPaise, expected: PAISE_EXPECTED },
  cod_fee: { prop: "codFee", validate: isPaise, expected: PAISE_EXPECTED },
  cod_min_order: { prop: "codMinOrder", validate: isPaise, expected: PAISE_EXPECTED },
  otp_ttl_seconds: intBetween("otpTtlSeconds", 60, 600),
  otp_resend_cooldown_seconds: intBetween("otpResendCooldownSeconds", 15, 600),
  otp_max_sends_per_window: intBetween("otpMaxSendsPerWindow", 1, 20),
  otp_send_window_seconds: intBetween("otpSendWindowSeconds", 600, 86_400),
  otp_max_attempts: intBetween("otpMaxAttempts", 1, 10),
  otp_max_sends_per_ip_hour: intBetween("otpMaxSendsPerIpHour", 1, 500),
  otp_max_sends_per_day: intBetween("otpMaxSendsPerDay", 1, 50),
  otp_daily_sms_cap: intBetween("otpDailySmsCap", 0, 100_000),
  new_device_alerts: bool("newDeviceAlerts"),
  cod_requires_otp: bool("codRequiresOtp"),
  cod_step_up_above: { prop: "codStepUpAbove", validate: isPaise, expected: PAISE_EXPECTED },
  staff_mfa_required: bool("staffMfaRequired"),
  google_signin_enabled: bool("googleSignInEnabled"),
  google_signin_percent: intBetween("googleSignInPercent", 0, 100),
};

export function isSettingKey(value: string): value is SettingKey {
  return value in DEFINITIONS;
}

/**
 * Validate an admin write — the M2 ops-route twin of the Fastify
 * updateSetting's refusal arm (packages/db/src/settings-repository.ts): an
 * unknown key or a wrong-shaped value is refused at the write, with the
 * reason worded for the operator who typed it. (The READ stays lenient —
 * mergeSettings skips bad stored rows — but a write that would be skipped
 * at every read is a no-op pretending to be a lever.)
 */
export function validateSettingWrite(
  key: string,
  value: unknown,
): { ok: true; key: SettingKey } | { ok: false; error: string } {
  if (!isSettingKey(key)) {
    return { ok: false, error: `unknown setting: ${key}` };
  }
  if (!DEFINITIONS[key].validate(value)) {
    return { ok: false, error: `${key}: ${DEFINITIONS[key].expected}` };
  }
  return { ok: true, key };
}

/** The sign-in limits, in the shape core's OTP rules take. */
export function otpPolicyOf(settings: Settings): OtpPolicy {
  return {
    ttlSeconds: settings.otpTtlSeconds,
    resendCooldownSeconds: settings.otpResendCooldownSeconds,
    maxSendsPerWindow: settings.otpMaxSendsPerWindow,
    sendWindowSeconds: settings.otpSendWindowSeconds,
    maxAttempts: settings.otpMaxAttempts,
  };
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
