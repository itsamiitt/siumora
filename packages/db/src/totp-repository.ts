import { createHash } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normaliseRecoveryCode,
  open,
  otpauthUri,
  seal,
  verifyTotp,
  type TotpFailure,
} from "@siumora/core";

import type { Database } from "./client.ts";
import { adminTotp, sessions } from "./schema.ts";

/**
 * Admin second factor.
 *
 * The interesting part is the replay refusal, and it has to happen here rather
 * than in the pure verifier: the last-used counter is shared state, and two
 * requests carrying the same code a millisecond apart must not both win. The
 * update is conditional on the counter still being what was read, so the second
 * one changes nothing and is refused.
 */

export type TotpRow = typeof adminTotp.$inferSelect;

export interface EnrolmentStarted {
  readonly secret: string;
  readonly uri: string;
  /** Shown once. They are not recoverable afterwards, by design. */
  readonly recoveryCodes: readonly string[];
}

/**
 * Begin enrolment.
 *
 * Replaces any unconfirmed enrolment: somebody who scanned a code, lost the
 * phone and started again must not be blocked by the abandoned attempt. A
 * *confirmed* one is never replaced silently — that would let anyone with a
 * live session quietly swap the second factor for their own.
 */
export async function startTotpEnrolment(
  db: Database,
  customerId: string,
  account: string,
  key: Buffer,
): Promise<EnrolmentStarted | { readonly alreadyEnrolled: true }> {
  const [existing] = await db
    .select()
    .from(adminTotp)
    .where(eq(adminTotp.customerId, customerId));

  if (existing?.confirmedAt) return { alreadyEnrolled: true };

  const secret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes();

  await db
    .insert(adminTotp)
    .values({
      customerId,
      secretSealed: seal(secret, key),
      recoveryHashes: recoveryCodes.map(hashRecoveryCode),
    })
    .onConflictDoUpdate({
      target: adminTotp.customerId,
      set: {
        secretSealed: seal(secret, key),
        recoveryHashes: recoveryCodes.map(hashRecoveryCode),
        confirmedAt: null,
        lastUsedStep: null,
      },
    });

  return { secret, uri: otpauthUri({ secret, account }), recoveryCodes };
}

export type VerifyOutcome =
  | { readonly ok: true; readonly usedRecoveryCode: boolean }
  | { readonly ok: false; readonly reason: TotpFailure | "not_enrolled" | "unreadable" };

/**
 * Check a code and spend it.
 *
 * `confirming` accepts a code against an enrolment that has not been confirmed
 * yet, which is how enrolment finishes — the operator proves the app actually
 * has the secret before the factor starts being required.
 */
export async function verifyTotpCode(
  db: Database,
  customerId: string,
  code: string,
  key: Buffer,
  options: { at?: Date; confirming?: boolean } = {},
): Promise<VerifyOutcome> {
  const [row] = await db
    .select()
    .from(adminTotp)
    .where(eq(adminTotp.customerId, customerId));

  if (!row) return { ok: false, reason: "not_enrolled" };
  if (!options.confirming && !row.confirmedAt) {
    return { ok: false, reason: "not_enrolled" };
  }

  const secret = open(row.secretSealed, key);
  if (!secret) {
    // A rotated or wrong key. Refused rather than thrown: the operator should
    // be told to re-enrol, not handed a stack trace.
    return { ok: false, reason: "unreadable" };
  }

  const result = verifyTotp(secret, code, {
    ...(options.at ? { at: options.at } : {}),
    ...(row.lastUsedStep !== null ? { lastUsedStep: row.lastUsedStep } : {}),
  });

  if (!result.valid) {
    // Both refusals, not just "mismatch": a recovery code is eleven characters
    // with a hyphen, so the TOTP verifier calls it malformed and never gets as
    // far as calling it wrong. Checking only mismatch made the recovery codes
    // undeemable, which is exactly when nobody would find out — the day
    // somebody's phone is gone.
    if (result.reason === "mismatch" || result.reason === "malformed") {
      const recovered = await spendRecoveryCode(db, row, code, options.at);
      if (recovered) return { ok: true, usedRecoveryCode: true };
    }
    return { ok: false, reason: result.reason };
  }

  // Conditional on the counter still being what was read. Two requests carrying
  // the same code a millisecond apart both pass the pure check; only one gets
  // to move the counter, and the other's update matches no row.
  const spent = await db
    .update(adminTotp)
    .set({
      lastUsedStep: result.step,
      ...(options.confirming ? { confirmedAt: options.at ?? new Date() } : {}),
    })
    .where(
      sql`${adminTotp.customerId} = ${customerId}
          AND (${adminTotp.lastUsedStep} IS NULL OR ${adminTotp.lastUsedStep} = ${row.lastUsedStep})`,
    )
    .returning({ customerId: adminTotp.customerId });

  if (spent.length === 0) return { ok: false, reason: "replayed" };
  return { ok: true, usedRecoveryCode: false };
}

/**
 * Spend a recovery code, if that is what was typed.
 *
 * Single-use: the hash is removed whether or not anything else succeeds, so a
 * code read off a screenshot works exactly once.
 */
async function spendRecoveryCode(
  db: Database,
  row: TotpRow,
  code: string,
  at?: Date,
): Promise<boolean> {
  const normalised = normaliseRecoveryCode(code);
  if (normalised.length < 8) return false;

  const hashes = row.recoveryHashes as string[];
  const attempt = hashRecoveryCode(`${normalised.slice(0, 5)}-${normalised.slice(5)}`);
  if (!hashes.includes(attempt)) return false;

  const remaining = hashes.filter((hash) => hash !== attempt);
  const spent = await db
    .update(adminTotp)
    .set({
      recoveryHashes: remaining,
      // A recovery code confirms the enrolment too: somebody using one has
      // proved they hold the codes handed out at enrolment.
      ...(row.confirmedAt ? {} : { confirmedAt: at ?? new Date() }),
    })
    .where(
      sql`${adminTotp.customerId} = ${row.customerId}
          AND ${adminTotp.recoveryHashes} = ${JSON.stringify(hashes)}::jsonb`,
    )
    .returning({ customerId: adminTotp.customerId });

  // Lost the race with another request spending the same code.
  return spent.length > 0;
}

export interface TotpState {
  readonly enrolled: boolean;
  readonly confirmedAt: Date | null;
  readonly recoveryCodesLeft: number;
}

export async function totpState(
  db: Database,
  customerId: string,
): Promise<TotpState> {
  const [row] = await db
    .select()
    .from(adminTotp)
    .where(eq(adminTotp.customerId, customerId));

  if (!row) return { enrolled: false, confirmedAt: null, recoveryCodesLeft: 0 };
  return {
    enrolled: row.confirmedAt !== null,
    confirmedAt: row.confirmedAt,
    recoveryCodesLeft: (row.recoveryHashes as string[]).length,
  };
}

/**
 * Remove the second factor.
 *
 * Every session's step-up is cleared at the same time. Leaving them stepped up
 * would mean the factor could be removed and re-added without anybody having to
 * prove anything in between.
 */
export async function removeTotp(
  db: Database,
  customerId: string,
): Promise<void> {
  await db.delete(adminTotp).where(eq(adminTotp.customerId, customerId));
  await db
    .update(sessions)
    .set({ twoFactorAt: null })
    .where(eq(sessions.customerId, customerId));
}

/** Mark this session as having passed the second factor. */
export async function markSessionStepUp(
  db: Database,
  sessionId: string,
  at: Date = new Date(),
): Promise<void> {
  await db
    .update(sessions)
    .set({ twoFactorAt: at })
    .where(eq(sessions.id, sessionId));
}

/** SHA-256, matching how session tokens are stored. */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
