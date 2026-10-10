import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Customer sessions — the pure half (auth plan phase 1).
 *
 * Medusa's customer JWT is stateless: once minted it cannot be revoked, so
 * "sign out everywhere" (what someone does after losing a phone) and the
 * operator's "revoke this session" have nothing to act on. The Fastify stack
 * solved this with an opaque token over a sessions table
 * (packages/db createSession/findSession); this module ports that model:
 *
 * - The storefront holds an opaque `sst_…` token in its HTTP-only cookie.
 *   Only its SHA-256 lives in the table, so a database read leaks no
 *   usable session.
 * - Every /store and /admin/siumora request carrying one is resolved
 *   against the table (src/lib/session-auth.ts) and, if live, turned into a
 *   short-lived Medusa JWT for the rest of the request — so Medusa's own
 *   routes keep working unchanged, and revocation takes effect on the very
 *   next request.
 * - Customer sessions roll: activity pushes expiry out to 30 days from the
 *   last visit. Operator sessions (a phone on ADMIN_PHONES) are a fixed 12
 *   hours — the Fastify ADMIN_SESSION_TTL_SECONDS — because they can read
 *   every customer's address.
 *
 * No Medusa imports here, so node --test can strip-type it.
 */

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { ADMIN_SESSION_TTL_SECONDS, SESSION_TTL_SECONDS } from "@siumora/core";

export const SESSION_TOKEN_PREFIX = "sst_";

/** 32 random bytes, base64url — 43 characters after the prefix. */
const TOKEN_PATTERN = /^sst_[A-Za-z0-9_-]{43}$/;

export type SessionKind = "customer" | "operator";

/** Write last_seen_at at most this often; a page view is not a row update. */
export const TOUCH_INTERVAL_MS = 5 * 60_000;

/** A sensitive action needs an OTP passed within this window (StepUpGate). */
export const STEP_UP_WINDOW_SECONDS = 10 * 60;

/** Lifetime of the per-request Medusa JWT minted from a live session. */
export const REQUEST_JWT_TTL = "5m";

export function mintSessionToken(): string {
  return `${SESSION_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function isSessionToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

/** What the table stores. A plain hash is enough: the token is 256 random
 *  bits, so there is nothing for a salt or a slow hash to protect. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The bearer token from an Authorization header, if it is one of ours.
 * Anything else (a Medusa JWT, a secret API key, garbage) is left for
 * Medusa's own authenticate() to judge.
 */
export function sessionTokenFromHeader(header: unknown): string | undefined {
  const token = bearerToken(header);
  return token && isSessionToken(token) ? token : undefined;
}

/**
 * The bearer token from an Authorization header, parsed EXACTLY as Medusa's
 * authenticate() parses it (an unanchored `(\S+)\s+(\S+)`, first match).
 * Anything stricter here would let `Bearer <jwt> junk` slip past our checks
 * while Medusa still accepts the token (security review).
 */
export function bearerToken(header: unknown): string | undefined {
  if (typeof header !== "string") return undefined;
  const match = /(\S+)\s+(\S+)/.exec(header);
  if (!match || match[1]!.toLowerCase() !== "bearer") return undefined;
  return match[2];
}

export function sessionTtlSeconds(kind: SessionKind): number {
  return kind === "operator" ? ADMIN_SESSION_TTL_SECONDS : SESSION_TTL_SECONDS;
}

export function initialExpiry(kind: SessionKind, now: Date): Date {
  return new Date(now.getTime() + sessionTtlSeconds(kind) * 1000);
}

export interface TouchDecision {
  readonly touch: boolean;
  /** The expiry to write when touching; unchanged for operator sessions. */
  readonly expiresAt: Date;
}

/**
 * Whether a request should write last_seen_at, and the expiry it writes.
 * Customer sessions slide (30 days from the last visit); operator sessions
 * never extend.
 */
export function touchDecision(
  session: { kind: SessionKind; lastSeenAt: Date; expiresAt: Date },
  now: Date,
): TouchDecision {
  const touch = now.getTime() - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS;
  if (!touch || session.kind === "operator") {
    return { touch, expiresAt: session.expiresAt };
  }
  return { touch, expiresAt: initialExpiry("customer", now) };
}

export function stepUpFresh(stepUpAt: Date | null | undefined, now: Date): boolean {
  if (!stepUpAt) return false;
  const age = now.getTime() - stepUpAt.getTime();
  return age >= 0 && age <= STEP_UP_WINDOW_SECONDS * 1000;
}

/**
 * "Chrome on Android" — enough for a customer to recognise their own phone
 * in the sessions list, and for the new-device alert to tell devices apart.
 * Deliberately coarse: a fingerprint would be both creepier and flakier.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (!ua) return "Unknown device";

  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : /node|undici|curl|okhttp/i.test(ua)
                ? "App"
                : "Browser";

  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iPhone"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : undefined;

  return os ? `${browser} on ${os}` : browser;
}

/**
 * A sign-in from a device label this customer has not used before — the
 * trigger for the WhatsApp security alert. The very first sign-in is not
 * "new": there is nothing to compare it to, and alerting someone on their
 * first ever sign-in is noise.
 */
export function isNewDevice(label: string, knownLabels: readonly string[]): boolean {
  return knownLabels.length > 0 && !knownLabels.includes(label);
}

/**
 * Phone numbers in the auth event log are keyed, not stored: the abuse view
 * needs "this number was hit 40 times", not the number itself. Keyed with a
 * server secret so the hash cannot be reversed by hashing all 10^10 numbers.
 */
export function phoneKey(phone: string, secret: string): string {
  return createHmac("sha256", secret).update(phone).digest("hex").slice(0, 32);
}

/** The IP an event log keeps: IPv4 to /24, IPv6 to /48 — enough to group
 *  abuse by network, not enough to pin a household. */
export function coarseIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (ip.includes(":")) {
    const groups = ip.split(":").filter(Boolean).slice(0, 3);
    return `${groups.join(":")}::/48`;
  }
  return null;
}

export interface SessionView {
  readonly id: string;
  readonly device: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  readonly current: boolean;
}

export interface SessionRow {
  id: string;
  device: string | null;
  created_at: Date | string;
  last_seen_at: Date | string;
  expires_at: Date | string;
}

/** The customer-facing list entry. No IP: the customer does not need it to
 *  recognise a device, and the list is one stolen session away from public. */
export function sessionView(row: SessionRow, currentId: string | undefined): SessionView {
  return {
    id: row.id,
    device: row.device ?? "Unknown device",
    createdAt: new Date(row.created_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    current: row.id === currentId,
  };
}
