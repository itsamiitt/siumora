/**
 * The OTP challenge, as pure functions over JSON-serializable state.
 *
 * This is the Medusa port of packages/db/src/auth-repository.ts's challenge
 * handling (parity bar: apps/api/src/routes/auth.ts + its tests). The policy
 * itself — 6-digit code, 300s TTL, 45s resend cooldown, 5 codes/hour,
 * 5 guesses per code — lives in @siumora/core (evaluateOtpRequest /
 * evaluateOtpVerification) and is imported, not copied. What this file adds is
 * the storage shape: instead of an `otp_challenges` table row, the challenge
 * lives in the auth provider identity's `provider_metadata` (see service.ts
 * for why), so the state here must round-trip through JSON.
 *
 * Secrets discipline is the same as the Fastify side: the code is salted and
 * stretched with scrypt before it is stored — a plain hash of a six-digit
 * number is a lookup table — and comparison is timingSafeEqual.
 */

import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Runtime resolution is the M0 dist refactor's require condition
// (dist/index.cjs). tsc's node16 CJS mode flags the import because the
// package's types are ESM-flavored (TS1479) — a packages/core exports-map
// concern shared by every @siumora/* import in this app, not a runtime one.
// prettier-ignore -- single line so @ts-ignore reaches the specifier
// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { OTP_LENGTH, OTP_SEND_WINDOW_SECONDS, OTP_TTL_SECONDS, evaluateOtpRequest, evaluateOtpVerification, type OtpVerificationStatus } from "@siumora/core";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/** Mint a numeric code. `randomInt`, not `Math.random` — this guards an account. */
export function generateOtp(): string {
  const max = 10 ** OTP_LENGTH;
  return String(randomInt(0, max)).padStart(OTP_LENGTH, "0");
}

/** Exactly OTP_LENGTH digits — checked before an attempt is ever spent. */
export function isOtpCodeShape(code: string): boolean {
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code);
}

async function hashCode(code: string, salt: Buffer): Promise<string> {
  const derived = await scryptAsync(code, salt, 32);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

async function codeMatches(code: string, stored: string): Promise<boolean> {
  const [saltHex, digestHex] = stored.split(":");
  if (!saltHex || !digestHex) return false;

  const expected = Buffer.from(digestHex, "hex");
  const actual = await scryptAsync(code, Buffer.from(saltHex, "hex"), expected.length);
  // Length is fixed by keylen, so timingSafeEqual cannot throw here.
  return timingSafeEqual(actual, expected);
}

/**
 * One number's challenge state, stored under `provider_metadata.otp`.
 *
 * There is deliberately only one slot per phone: writing a new challenge
 * replaces the old one, which is exactly the Fastify rule "only the newest
 * challenge is considered — requesting a second code invalidates the first".
 * All fields are JSON scalars because provider_metadata is a JSONB column.
 */
export interface OtpChallengeState {
  /** scrypt `salt:digest` of the code — never the code itself. */
  readonly code_hash: string;
  readonly issued_at: string;
  readonly expires_at: string;
  /** Failed guesses against this code so far. */
  readonly attempts: number;
  /** Set once the code has signed someone in; a consumed code never works again. */
  readonly consumed_at: string | null;
  /** ISO timestamps of recent sends — the input to the resend throttle. */
  readonly sent_at: readonly string[];
}

/** Defensive read of whatever is sitting in provider_metadata. */
export function readChallengeState(
  metadata: Record<string, unknown> | null | undefined,
): OtpChallengeState | undefined {
  const raw = metadata?.otp;
  if (typeof raw !== "object" || raw === null) return undefined;
  const state = raw as Record<string, unknown>;
  if (typeof state.code_hash !== "string") return undefined;
  if (typeof state.expires_at !== "string") return undefined;
  if (typeof state.attempts !== "number") return undefined;

  return {
    code_hash: state.code_hash,
    issued_at: typeof state.issued_at === "string" ? state.issued_at : "",
    expires_at: state.expires_at,
    attempts: state.attempts,
    consumed_at: typeof state.consumed_at === "string" ? state.consumed_at : null,
    sent_at: Array.isArray(state.sent_at)
      ? state.sent_at.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

export type IssueOutcome =
  | {
      readonly allowed: true;
      readonly state: OtpChallengeState;
      /** Returned so the caller can send (or echo) it. Never readable again. */
      readonly code: string;
      readonly expiresAt: Date;
    }
  | {
      readonly allowed: false;
      readonly reason: string;
      readonly retryAfterSeconds: number;
    };

/**
 * Issue a fresh challenge for a number, replacing any previous one.
 *
 * The resend throttle (45s cooldown, 5 codes/hour — core's
 * evaluateOtpRequest) runs over the send history carried in the previous
 * state, so the same rules apply as on the Fastify side without a table to
 * query. History older than the window is trimmed on every write.
 */
export async function issueChallenge(
  previous: OtpChallengeState | undefined,
  now: Date = new Date(),
  ttlSeconds: number = OTP_TTL_SECONDS,
): Promise<IssueOutcome> {
  const history = (previous?.sent_at ?? [])
    .map((iso) => new Date(iso))
    .filter((date) => !Number.isNaN(date.getTime()));

  const decision = evaluateOtpRequest({ now, sentAt: history });
  if (!decision.allowed) {
    return {
      allowed: false,
      reason: decision.reason,
      retryAfterSeconds: decision.retryAfterSeconds,
    };
  }

  const code = generateOtp();
  const codeHash = await hashCode(code, randomBytes(16));
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  const windowStartMs = now.getTime() - OTP_SEND_WINDOW_SECONDS * 1000;
  const sentAt = history
    .filter((date) => date.getTime() > windowStartMs)
    .map((date) => date.toISOString())
    .concat(now.toISOString());

  return {
    allowed: true,
    code,
    expiresAt,
    state: {
      code_hash: codeHash,
      issued_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      attempts: 0,
      consumed_at: null,
      sent_at: sentAt,
    },
  };
}

export interface JudgeOutcome {
  readonly status: OtpVerificationStatus | "not_found";
  readonly attemptsRemaining: number;
  /** The state to persist back, when the judgement changed it. */
  readonly state?: OtpChallengeState;
}

/**
 * Judge one submitted code against the stored challenge.
 *
 * Ordering (consumed → expired → locked → match) is core's
 * evaluateOtpVerification, unchanged: a correct code that has expired, been
 * consumed, or been locked out never verifies. A mismatch counts the attempt
 * down; a verified code is marked consumed so it can never sign in twice.
 */
export async function judgeChallenge(
  state: OtpChallengeState | undefined,
  code: string,
  now: Date = new Date(),
): Promise<JudgeOutcome> {
  if (!state) return { status: "not_found", attemptsRemaining: 0 };

  const verdict = evaluateOtpVerification({
    now,
    expiresAt: new Date(state.expires_at),
    consumedAt: state.consumed_at ? new Date(state.consumed_at) : null,
    attempts: state.attempts,
    matches: await codeMatches(code, state.code_hash),
  });

  if (verdict.status === "verified") {
    return { ...verdict, state: { ...state, consumed_at: now.toISOString() } };
  }
  if (verdict.status === "mismatch") {
    return { ...verdict, state: { ...state, attempts: state.attempts + 1 } };
  }
  return { status: verdict.status, attemptsRemaining: verdict.attemptsRemaining };
}
