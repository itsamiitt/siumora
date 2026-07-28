import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import {
  OTP_LENGTH,
  OTP_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  evaluateOtpVerification,
  type OtpVerificationStatus,
} from "@siumora/core";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

import type { Database } from "./client.ts";
import { customers, otpChallenges, sessions } from "./schema.ts";

/**
 * Sign-in storage.
 *
 * Two secrets pass through here and neither is ever stored in the clear:
 *
 * - **The one-time code** is salted and stretched with scrypt. A plain hash of
 *   a six-digit number is a lookup table, and salting alone still falls to a
 *   million cheap hashes. scrypt makes one guess cost about a tenth of a second,
 *   so exhausting the space takes far longer than the code stays valid.
 * - **The session token** is stored as a SHA-256 digest. It is 256 bits of
 *   randomness, so stretching buys nothing, but a database dump must not be a
 *   pile of usable cookies.
 */

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

/** A session token is compared by exact digest, so a plain hash is enough. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** When codes were last sent to this number — the input to the throttle. */
export async function recentOtpSends(
  db: Database,
  phone: string,
  windowSeconds: number,
  now: Date = new Date(),
): Promise<Date[]> {
  const since = new Date(now.getTime() - windowSeconds * 1000);
  const rows = await db
    .select({ createdAt: otpChallenges.createdAt })
    .from(otpChallenges)
    .where(and(eq(otpChallenges.phone, phone), gt(otpChallenges.createdAt, since)));

  return rows.map((row) => row.createdAt);
}

/**
 * How many codes one origin has asked for.
 *
 * The per-number throttle does nothing against a script that walks a list of
 * numbers — each one is a first request. This is the limit that catches that.
 */
export async function otpSendsFromIp(
  db: Database,
  ip: string,
  windowSeconds: number,
  now: Date = new Date(),
): Promise<number> {
  if (!ip) return 0;
  const since = new Date(now.getTime() - windowSeconds * 1000);
  const rows = await db
    .select({ id: otpChallenges.id })
    .from(otpChallenges)
    .where(
      and(eq(otpChallenges.requestedIp, ip), gt(otpChallenges.createdAt, since)),
    );

  return rows.length;
}

export interface IssuedOtp {
  readonly id: string;
  readonly code: string;
  readonly expiresAt: Date;
}

export async function createOtpChallenge(
  db: Database,
  input: { phone: string; ip?: string; now?: Date; ttlSeconds?: number },
): Promise<IssuedOtp> {
  const now = input.now ?? new Date();
  const code = generateOtp();
  const codeHash = await hashCode(code, randomBytes(16));
  const expiresAt = new Date(
    now.getTime() + (input.ttlSeconds ?? OTP_TTL_SECONDS) * 1000,
  );

  const [row] = await db
    .insert(otpChallenges)
    .values({
      phone: input.phone,
      codeHash,
      requestedIp: input.ip ?? "",
      createdAt: now,
      expiresAt,
    })
    .returning({ id: otpChallenges.id });

  // The code is returned so the caller can send it. It is never readable again.
  return { id: row!.id, code, expiresAt };
}

export interface VerifyOtpResult {
  readonly status: OtpVerificationStatus | "not_found";
  readonly attemptsRemaining: number;
}

/**
 * Check one code against the newest challenge for the number.
 *
 * The row is locked for the whole check. Without the lock, ten parallel guesses
 * all read `attempts = 0`, and the five-attempt limit stops nothing — which is
 * exactly how a brute force is run against a naive implementation.
 *
 * Only the newest challenge is considered: requesting a second code must
 * invalidate the first, or every resend widens the window rather than
 * refreshing it.
 */
export async function verifyOtpChallenge(
  db: Database,
  input: { phone: string; code: string; now?: Date },
): Promise<VerifyOtpResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const locked = await tx.execute(
      sql`SELECT id, code_hash, attempts, expires_at, consumed_at
          FROM otp_challenges
          WHERE phone = ${input.phone}
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE`,
    );

    const row = locked.rows[0] as
      | {
          id: string;
          code_hash: string;
          attempts: number;
          expires_at: Date;
          consumed_at: Date | null;
        }
      | undefined;

    if (!row) return { status: "not_found" as const, attemptsRemaining: 0 };

    const verdict = evaluateOtpVerification({
      now,
      expiresAt: new Date(row.expires_at),
      consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
      attempts: row.attempts,
      matches: await codeMatches(input.code, row.code_hash),
    });

    if (verdict.status === "verified") {
      await tx
        .update(otpChallenges)
        .set({ consumedAt: now })
        .where(eq(otpChallenges.id, row.id));
    } else if (verdict.status === "mismatch") {
      await tx
        .update(otpChallenges)
        .set({ attempts: row.attempts + 1 })
        .where(eq(otpChallenges.id, row.id));
    }

    return verdict;
  });
}

export type CustomerRow = typeof customers.$inferSelect;

/**
 * The customer for a number, created on first sign-in.
 *
 * `onConflictDoUpdate` rather than select-then-insert: two devices signing in
 * at once would otherwise both see no row and both try to insert.
 */
export async function upsertCustomer(
  db: Database,
  phone: string,
  now: Date = new Date(),
): Promise<CustomerRow> {
  const [row] = await db
    .insert(customers)
    .values({ phone, createdAt: now, lastSeenAt: now })
    .onConflictDoUpdate({
      target: customers.phone,
      set: { lastSeenAt: now },
    })
    .returning();

  return row!;
}

export interface IssuedSession {
  readonly token: string;
  readonly expiresAt: Date;
}

export async function createSession(
  db: Database,
  input: {
    customerId: string;
    ttlSeconds?: number;
    userAgent?: string;
    now?: Date;
  },
): Promise<IssuedSession> {
  const now = input.now ?? new Date();
  // 256 bits, url-safe, so it can ride in a cookie or an Authorization header.
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    now.getTime() + (input.ttlSeconds ?? SESSION_TTL_SECONDS) * 1000,
  );

  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    customerId: input.customerId,
    createdAt: now,
    expiresAt,
    userAgent: (input.userAgent ?? "").slice(0, 300),
  });

  return { token, expiresAt };
}

export interface ResolvedSession {
  readonly sessionId: string;
  readonly customer: CustomerRow;
  readonly expiresAt: Date;
  /** When this session last passed the second factor, if ever. */
  readonly twoFactorAt: Date | null;
}

/**
 * Resolve a bearer token to the person holding it.
 *
 * Expiry and revocation are part of the query rather than a check afterwards,
 * so there is no path that forgets to apply them.
 */
export async function findSession(
  db: Database,
  token: string,
  now: Date = new Date(),
): Promise<ResolvedSession | undefined> {
  const [row] = await db
    .select({ session: sessions, customer: customers })
    .from(sessions)
    .innerJoin(customers, eq(customers.id, sessions.customerId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
      ),
    );

  if (!row) return undefined;
  return {
    sessionId: row.session.id,
    customer: row.customer,
    expiresAt: row.session.expiresAt,
    twoFactorAt: row.session.twoFactorAt,
  };
}

export async function revokeSession(
  db: Database,
  token: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
}

/** Sign out everywhere. What a customer wants after losing a phone. */
export async function revokeAllSessions(
  db: Database,
  customerId: string,
  now: Date = new Date(),
): Promise<number> {
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.customerId, customerId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });

  return revoked.length;
}

/** Housekeeping: spent and expired challenges are of no further use. */
export async function pruneOtpChallenges(
  db: Database,
  olderThan: Date,
): Promise<number> {
  const removed = await db
    .delete(otpChallenges)
    .where(sql`${otpChallenges.createdAt} < ${olderThan}`)
    .returning({ id: otpChallenges.id });

  return removed.length;
}
