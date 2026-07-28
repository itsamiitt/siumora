import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238).
 *
 * plan/11 §4 asks for admin 2FA, and the ops dashboard has been saying out loud
 * that it does not have any. TOTP rather than SMS: the second factor cannot be
 * the same channel as the first, and the first factor here is already a code
 * sent to a phone number. A SIM swap that takes the number would otherwise take
 * both.
 *
 * Implemented rather than pulled in — it is HMAC-SHA1 over a counter and a
 * base32 alphabet, and the pieces that actually decide whether it is safe
 * (constant-time comparison, drift window, replay refusal) are the pieces worth
 * having in front of you.
 */

/** Seconds per code. Thirty is what every authenticator app assumes. */
export const TOTP_STEP_SECONDS = 30;

/** Six digits. Eight is more entropy and nobody's app defaults to it. */
export const TOTP_DIGITS = 6;

/**
 * How many steps either side of now are accepted.
 *
 * One: a phone's clock drifts, and a person takes a moment to type. Wider is
 * tempting and each extra step is another live code — at ±3 there are seven
 * valid codes at any instant, which is a meaningful fraction of a million.
 */
export const TOTP_DRIFT_STEPS = 1;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A 160-bit secret, which is what RFC 4226 recommends for HMAC-SHA1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];

  // No padding. Authenticator apps accept it either way and every QR generator
  // omits it, so matching them avoids a class of "it says invalid secret".
  return output;
}

export function base32Decode(secret: string): Buffer {
  const cleaned = secret.toUpperCase().replace(/[=\s-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const character of cleaned) {
    const index = BASE32.indexOf(character);
    if (index === -1) throw new RangeError(`not base32: ${character}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/** The counter a moment falls in. Also the replay key. */
export function stepFor(at: Date, step = TOTP_STEP_SECONDS): number {
  return Math.floor(at.getTime() / 1000 / step);
}

/** The code for a given counter. */
export function totpCodeAtStep(secret: string, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", base32Decode(secret)).update(buffer).digest();

  // Dynamic truncation, RFC 4226 §5.3: the low nibble of the last byte picks
  // where to read four bytes from, and the top bit is masked off so the value
  // is unsigned whatever the language does with sign.
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const binary =
    (((digest[offset] as number) & 0x7f) << 24) |
    ((digest[offset + 1] as number) << 16) |
    ((digest[offset + 2] as number) << 8) |
    (digest[offset + 3] as number);

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function totpCode(secret: string, at: Date = new Date()): string {
  return totpCodeAtStep(secret, stepFor(at));
}

export type TotpResult =
  | { readonly valid: true; readonly step: number }
  | { readonly valid: false; readonly reason: TotpFailure };

export type TotpFailure =
  | "malformed"
  /** Right shape, wrong code. */
  | "mismatch"
  /**
   * Correct, but already spent. A TOTP is valid for thirty seconds and can be
   * used twice inside that window — which is exactly long enough for somebody
   * reading it over a shoulder, or replaying a captured request.
   */
  | "replayed";

/**
 * Check a code.
 *
 * `lastUsedStep` is what makes this a one-time password rather than a
 * thirty-second password. Without it the code is reusable for the rest of its
 * window, and the whole point of the second factor is that observing it once
 * does not grant access twice.
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: { at?: Date; lastUsedStep?: number; drift?: number } = {},
): TotpResult {
  const cleaned = code.replace(/\s/g, "");
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(cleaned)) {
    return { valid: false, reason: "malformed" };
  }

  const now = stepFor(options.at ?? new Date());
  const drift = options.drift ?? TOTP_DRIFT_STEPS;

  for (let offset = -drift; offset <= drift; offset += 1) {
    const step = now + offset;
    if (!constantTimeEquals(totpCodeAtStep(secret, step), cleaned)) continue;

    // Matched. Whether it counts depends on whether it has been spent.
    if (options.lastUsedStep !== undefined && step <= options.lastUsedStep) {
      return { valid: false, reason: "replayed" };
    }
    return { valid: true, step };
  }

  return { valid: false, reason: "mismatch" };
}

/**
 * Compare without leaking where the strings differ.
 *
 * A naive `===` returns faster on an early mismatch. Six digits is a small
 * enough space that a timing signal narrowing it digit by digit is not
 * theoretical.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The `otpauth://` URI an authenticator app scans.
 *
 * The issuer appears twice — once as a label prefix and once as a parameter —
 * because older apps read one and newer ones read the other, and an operator
 * with "Unknown account" in their app cannot tell which of three shops it is.
 */
export function otpauthUri(options: {
  secret: string;
  account: string;
  issuer?: string;
}): string {
  const issuer = options.issuer ?? "Siumora";
  const label = encodeURIComponent(`${issuer}:${options.account}`);
  const params = new URLSearchParams({
    secret: options.secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });

  return `otpauth://totp/${label}?${params}`;
}

/**
 * How long a verified second factor lasts before it is asked for again.
 *
 * Twelve hours: an operator works a shift without retyping a code, and a
 * session stolen overnight is not still stepped up in the morning. The session
 * itself lasts thirty days, which is exactly why this cannot ride along with it.
 */
export const STEP_UP_TTL_SECONDS = 12 * 3600;

export function stepUpValid(
  verifiedAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!verifiedAt) return false;
  return now.getTime() - verifiedAt.getTime() < STEP_UP_TTL_SECONDS * 1000;
}

/**
 * Recovery codes, for the phone that fell in a river.
 *
 * Single-use, and shown once. Without them, losing the authenticator locks the
 * owner out of their own shop and the only way back is a database edit — which
 * is a worse security posture than the codes, because somebody will keep a
 * standing way to do it.
 */
export const RECOVERY_CODE_COUNT = 8;

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    // Base32 without vowels would be tidier, but these are read off a screen
    // once and typed once; a familiar alphabet beats a clever one.
    const raw = base32Encode(randomBytes(10)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export function normaliseRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, "");
}
