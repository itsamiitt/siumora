/**
 * Phone sign-in policy.
 *
 * A phone number and a one-time code is the sign-in Indian shoppers expect —
 * no password to forget, and the number is already the delivery contact. It is
 * also one of the most abused endpoints on an Indian storefront: sending an SMS
 * or WhatsApp template costs real money per attempt, so an unthrottled "send
 * code" button is a bill somebody else can run up, and a code with unlimited
 * guesses is a six-digit number brute-forced in minutes.
 *
 * The throttles therefore live here as pure functions over timestamps, so they
 * are testable without a clock, a database or a provider, and so the same rules
 * apply wherever a code is issued.
 */

export const OTP_LENGTH = 6;

/** How long a code stays valid. Long enough for a slow SMS, short enough that
 *  an intercepted code is stale by the time it is read off a shoulder. */
export const OTP_TTL_SECONDS = 300;

/** Minimum gap between two codes to the same number. */
export const OTP_RESEND_COOLDOWN_SECONDS = 45;

/** Codes per number per window. Past this, the number is a target, not a user. */
export const OTP_MAX_SENDS_PER_WINDOW = 5;

export const OTP_SEND_WINDOW_SECONDS = 3600;

/** Guesses allowed against one code. 5 of 10^6 is not a brute force. */
export const OTP_MAX_ATTEMPTS = 5;

/** Customer sessions are long — re-authenticating a shopper costs orders. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/** Admin sessions are not: that cookie can read every customer's address. */
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;

/**
 * Reduce anything a person might type to a bare 10-digit Indian mobile.
 *
 * Returns `undefined` rather than throwing: an unparseable number is an
 * ordinary outcome of a form, not an exceptional one.
 */
export function normalisePhone(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, "");

  let local = digits;
  if (local.length === 14 && local.startsWith("0091")) local = local.slice(4);
  else if (local.length === 12 && local.startsWith("91")) local = local.slice(2);
  else if (local.length === 11 && local.startsWith("0")) local = local.slice(1);

  // Indian mobile numbers begin 6–9. A landline or a typo is rejected here
  // rather than after the money has been spent sending a code to it.
  return /^[6-9]\d{9}$/.test(local) ? local : undefined;
}

/** E.164, for the WhatsApp/SMS provider and for hashed analytics identity. */
export function toE164(phone: string): string {
  return `+91${phone}`;
}

/**
 * Partly hidden number, for screens and logs.
 *
 * The last four digits are what a customer recognises as theirs; the middle
 * four are what makes the number reachable, so those are the ones to drop.
 */
export function maskPhone(phone: string): string {
  if (phone.length !== 10) return "••••";
  return `${phone.slice(0, 2)}••••${phone.slice(6)}`;
}

export interface OtpRequestInput {
  readonly now: Date;
  /** When earlier codes went to this number. Order does not matter. */
  readonly sentAt: readonly Date[];
}

export type OtpRequestDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: string;
      readonly retryAfterSeconds: number;
    };

/**
 * May another code be sent to this number now?
 *
 * Two limits, because they stop different things: the cooldown stops an
 * impatient tap-tap-tap, the hourly cap stops a script. A refusal always says
 * how long to wait, so the storefront can count down instead of guessing.
 */
export function evaluateOtpRequest(input: OtpRequestInput): OtpRequestDecision {
  const nowMs = input.now.getTime();
  const windowStartMs = nowMs - OTP_SEND_WINDOW_SECONDS * 1000;

  const recent = input.sentAt
    .map((date) => date.getTime())
    .filter((time) => time > windowStartMs)
    .sort((a, b) => b - a);

  const newest = recent[0];
  const cooldownLeft =
    newest === undefined
      ? 0
      : Math.ceil((newest + OTP_RESEND_COOLDOWN_SECONDS * 1000 - nowMs) / 1000);

  if (recent.length >= OTP_MAX_SENDS_PER_WINDOW) {
    // The cap lifts when the oldest send ages out of the window, not when the
    // window length has passed from now.
    const oldest = recent[recent.length - 1] as number;
    const windowLeft = Math.ceil(
      (oldest + OTP_SEND_WINDOW_SECONDS * 1000 - nowMs) / 1000,
    );
    return {
      allowed: false,
      reason: "Too many codes requested for this number. Try again later.",
      retryAfterSeconds: Math.max(windowLeft, cooldownLeft, 1),
    };
  }

  if (cooldownLeft > 0) {
    return {
      allowed: false,
      reason: `Wait ${cooldownLeft}s before asking for another code.`,
      retryAfterSeconds: cooldownLeft,
    };
  }

  return { allowed: true };
}

export type OtpVerificationStatus =
  | "verified"
  | "expired"
  | "consumed"
  | "locked"
  | "mismatch";

export interface OtpVerificationInput {
  readonly now: Date;
  readonly expiresAt: Date;
  /** Set once the code has already signed someone in. */
  readonly consumedAt?: Date | null;
  /** Failed guesses made against this code so far. */
  readonly attempts: number;
  /** Whether the submitted code matches. Compared by the caller, in constant time. */
  readonly matches: boolean;
}

export interface OtpVerification {
  readonly status: OtpVerificationStatus;
  readonly attemptsRemaining: number;
}

/**
 * Judge one attempt against one code.
 *
 * The checks run before the match on purpose. Reading `matches` first would
 * accept a correct code that had expired, or let the same code sign in twice —
 * and a replayed code is exactly what someone who read it over a shoulder has.
 */
export function evaluateOtpVerification(
  input: OtpVerificationInput,
): OtpVerification {
  if (input.consumedAt) return { status: "consumed", attemptsRemaining: 0 };
  if (input.now.getTime() >= input.expiresAt.getTime()) {
    return { status: "expired", attemptsRemaining: 0 };
  }
  if (input.attempts >= OTP_MAX_ATTEMPTS) {
    return { status: "locked", attemptsRemaining: 0 };
  }
  if (input.matches) return { status: "verified", attemptsRemaining: 0 };

  return {
    status: "mismatch",
    attemptsRemaining: Math.max(0, OTP_MAX_ATTEMPTS - (input.attempts + 1)),
  };
}

/**
 * Is this number an operator?
 *
 * Admin is an allow-list of numbers held in the environment rather than a flag
 * on a row, so granting it is a deploy someone has to make deliberately and can
 * be read straight off the running configuration.
 */
export function isAdminPhone(
  phone: string,
  allowList: readonly string[],
): boolean {
  return allowList
    .map((entry) => normalisePhone(entry))
    .some((entry) => entry !== undefined && entry === phone);
}

/** Parse the ADMIN_PHONES environment value — comma or space separated. */
export function parseAdminPhones(raw: string | undefined): string[] {
  if (!raw) return [];
  // Split on commas only. Splitting on whitespace too would tear "+91 98765
  // 43210" into three fragments and silently drop a configured operator.
  return raw
    .split(",")
    .map((entry) => normalisePhone(entry))
    .filter((entry): entry is string => entry !== undefined);
}
