import { randomUUID } from "node:crypto";

import {
  hashSessionToken,
  initialExpiry,
  mintSessionToken,
  type SessionKind,
} from "./session.ts";

/**
 * The session, security and auth-event read/write paths, in raw SQL against
 * the shared pg connection (ContainerRegistrationKeys.PG_CONNECTION — a knex
 * client): the convention of audit/data.ts and wishlist/store.ts. The
 * generated module service exists only so the module owns its tables.
 */

type Binding = string | number | boolean | null;

/** Structural slice of knex so this file needs no knex type dependency. */
export interface SqlClient {
  raw(sql: string, bindings?: ReadonlyArray<Binding>): Promise<{ rows: unknown[] }>;
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

// ── Sessions ────────────────────────────────────────────────────────────

export interface CreatedSession {
  readonly id: string;
  /** The opaque token. Returned once, never stored. */
  readonly token: string;
  readonly expiresAt: Date;
}

export async function createSession(
  pg: SqlClient,
  input: {
    customerId: string;
    authIdentityId: string;
    kind: SessionKind;
    device: string;
    userAgent?: string | undefined;
    ip?: string | null | undefined;
    now: Date;
    /** False for a Google sign-in: only a phone OTP counts as a step-up. */
    stepUp?: boolean;
  },
): Promise<CreatedSession> {
  const id = newId("sises");
  const token = mintSessionToken();
  const expiresAt = initialExpiry(input.kind, input.now);
  const now = input.now.toISOString();
  await pg.raw(
    `INSERT INTO siumora_customer_session
       (id, customer_id, auth_identity_id, token_hash, kind, device, user_agent, ip,
        last_seen_at, expires_at, step_up_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.customerId,
      input.authIdentityId,
      hashSessionToken(token),
      input.kind,
      input.device,
      (input.userAgent ?? "").slice(0, 400),
      input.ip ?? null,
      now,
      expiresAt.toISOString(),
      // Signing in with an OTP IS a fresh code: the session starts stepped
      // up. A Google sign-in proves no phone, so it does not (security review).
      input.stepUp === false ? null : now,
      now,
      now,
    ],
  );
  return { id, token, expiresAt };
}

export interface ResolvedSession {
  readonly id: string;
  readonly customerId: string;
  readonly authIdentityId: string;
  readonly kind: SessionKind;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly stepUpAt: Date | null;
  readonly blocked: boolean;
}

interface ResolvedRow {
  id: string;
  customer_id: string;
  auth_identity_id: string;
  kind: string;
  last_seen_at: Date | string;
  expires_at: Date | string;
  step_up_at: Date | string | null;
  blocked_at: Date | string | null;
}

/** A live (unrevoked, unexpired) session for this token, with its owner's
 *  block state — one round trip on every authenticated request. */
export async function resolveSession(
  pg: SqlClient,
  token: string,
  now: Date,
): Promise<ResolvedSession | undefined> {
  const result = await pg.raw(
    `SELECT s.id, s.customer_id, s.auth_identity_id, s.kind, s.last_seen_at,
            s.expires_at, s.step_up_at, sec.blocked_at
       FROM siumora_customer_session s
       LEFT JOIN siumora_customer_security sec
              ON sec.customer_id = s.customer_id AND sec.deleted_at IS NULL
      WHERE s.token_hash = ?
        AND s.revoked_at IS NULL
        AND s.deleted_at IS NULL
        AND s.expires_at > ?
      LIMIT 1`,
    [hashSessionToken(token), now.toISOString()],
  );
  const row = result.rows[0] as ResolvedRow | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    customerId: row.customer_id,
    authIdentityId: row.auth_identity_id,
    kind: row.kind === "operator" ? "operator" : "customer",
    lastSeenAt: new Date(row.last_seen_at),
    expiresAt: new Date(row.expires_at),
    stepUpAt: row.step_up_at ? new Date(row.step_up_at) : null,
    blocked: row.blocked_at !== null && row.blocked_at !== undefined,
  };
}

export async function touchSession(
  pg: SqlClient,
  id: string,
  now: Date,
  expiresAt: Date,
): Promise<void> {
  await pg.raw(
    `UPDATE siumora_customer_session
        SET last_seen_at = ?, expires_at = ?, updated_at = ?
      WHERE id = ? AND revoked_at IS NULL`,
    [now.toISOString(), expiresAt.toISOString(), now.toISOString(), id],
  );
}

export async function markStepUp(pg: SqlClient, id: string, now: Date): Promise<void> {
  await pg.raw(
    `UPDATE siumora_customer_session SET step_up_at = ?, updated_at = ? WHERE id = ?`,
    [now.toISOString(), now.toISOString(), id],
  );
}

export interface SessionListRow {
  id: string;
  device: string | null;
  ip: string | null;
  kind: string;
  created_at: Date | string;
  last_seen_at: Date | string;
  expires_at: Date | string;
}

/** Live sessions, most recently used first. */
export async function listSessions(
  pg: SqlClient,
  customerId: string,
  now: Date,
): Promise<SessionListRow[]> {
  const result = await pg.raw(
    `SELECT id, device, ip, kind, created_at, last_seen_at, expires_at
       FROM siumora_customer_session
      WHERE customer_id = ? AND revoked_at IS NULL AND deleted_at IS NULL AND expires_at > ?
      ORDER BY last_seen_at DESC
      LIMIT 50`,
    [customerId, now.toISOString()],
  );
  return result.rows as SessionListRow[];
}

export type RevokeReason =
  | "signout"
  | "signout_everywhere"
  | "revoked_by_customer"
  | "revoked_by_operator"
  | "blocked"
  | "reverify"
  | "merged"
  | "erased";

/** Revoke one session by token (sign out). Idempotent: 0 is a success. */
export async function revokeSessionByToken(
  pg: SqlClient,
  token: string,
  reason: RevokeReason,
  now: Date,
): Promise<number> {
  const result = await pg.raw(
    `UPDATE siumora_customer_session
        SET revoked_at = ?, revoked_reason = ?, updated_at = ?
      WHERE token_hash = ? AND revoked_at IS NULL
      RETURNING id`,
    [now.toISOString(), reason, now.toISOString(), hashSessionToken(token)],
  );
  return result.rows.length;
}

/** Revoke one session by id, scoped to its owner so a customer can only
 *  ever reach their own. */
export async function revokeSessionById(
  pg: SqlClient,
  input: { id: string; customerId: string; reason: RevokeReason; now: Date },
): Promise<number> {
  const result = await pg.raw(
    `UPDATE siumora_customer_session
        SET revoked_at = ?, revoked_reason = ?, updated_at = ?
      WHERE id = ? AND customer_id = ? AND revoked_at IS NULL
      RETURNING id`,
    [input.now.toISOString(), input.reason, input.now.toISOString(), input.id, input.customerId],
  );
  return result.rows.length;
}

export async function revokeAllSessions(
  pg: SqlClient,
  input: { customerId: string; reason: RevokeReason; now: Date; exceptId?: string },
): Promise<number> {
  const result = await pg.raw(
    `UPDATE siumora_customer_session
        SET revoked_at = ?, revoked_reason = ?, updated_at = ?
      WHERE customer_id = ? AND revoked_at IS NULL AND id <> ?
      RETURNING id`,
    [
      input.now.toISOString(),
      input.reason,
      input.now.toISOString(),
      input.customerId,
      input.exceptId ?? "",
    ],
  );
  return result.rows.length;
}

/** Device labels this customer signed in from in the last 180 days. */
export async function knownDevices(
  pg: SqlClient,
  customerId: string,
  now: Date,
  excludeId?: string,
): Promise<string[]> {
  const since = new Date(now.getTime() - 180 * 86_400_000).toISOString();
  const result = await pg.raw(
    `SELECT DISTINCT device FROM siumora_customer_session
      WHERE customer_id = ? AND created_at > ? AND id <> ? AND device IS NOT NULL`,
    [customerId, since, excludeId ?? ""],
  );
  return (result.rows as Array<{ device: string }>).map((row) => row.device);
}

// ── Security state (block, merge) ───────────────────────────────────────

export interface SecurityState {
  readonly blockedAt: string | null;
  readonly blockedReason: string | null;
  readonly blockedBy: string | null;
  readonly mergedInto: string | null;
}

const OPEN_STATE: SecurityState = {
  blockedAt: null,
  blockedReason: null,
  blockedBy: null,
  mergedInto: null,
};

export async function readSecurity(pg: SqlClient, customerId: string): Promise<SecurityState> {
  const result = await pg.raw(
    `SELECT blocked_at, blocked_reason, blocked_by, merged_into
       FROM siumora_customer_security WHERE customer_id = ? AND deleted_at IS NULL`,
    [customerId],
  );
  const row = result.rows[0] as
    | {
        blocked_at: Date | string | null;
        blocked_reason: string | null;
        blocked_by: string | null;
        merged_into: string | null;
      }
    | undefined;
  if (!row) return OPEN_STATE;
  return {
    blockedAt: row.blocked_at ? new Date(row.blocked_at).toISOString() : null,
    blockedReason: row.blocked_reason,
    blockedBy: row.blocked_by,
    mergedInto: row.merged_into,
  };
}

export async function setBlocked(
  pg: SqlClient,
  input: {
    customerId: string;
    blocked: boolean;
    reason?: string;
    by: string;
    now: Date;
    mergedInto?: string;
  },
): Promise<void> {
  const now = input.now.toISOString();
  await pg.raw(
    `INSERT INTO siumora_customer_security
       (customer_id, blocked_at, blocked_reason, blocked_by, merged_into, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (customer_id) DO UPDATE
       SET blocked_at = EXCLUDED.blocked_at,
           blocked_reason = EXCLUDED.blocked_reason,
           blocked_by = EXCLUDED.blocked_by,
           merged_into = COALESCE(EXCLUDED.merged_into, siumora_customer_security.merged_into),
           updated_at = EXCLUDED.updated_at,
           deleted_at = NULL`,
    [
      input.customerId,
      input.blocked ? now : null,
      input.blocked ? (input.reason ?? null) : null,
      input.blocked ? input.by : null,
      input.mergedInto ?? null,
      now,
      now,
    ],
  );
}

// ── Auth events ─────────────────────────────────────────────────────────

export const AUTH_EVENT_TYPES = [
  "otp_requested",
  "otp_sent",
  "otp_send_failed",
  "otp_rate_limited",
  "otp_verified",
  "otp_failed",
  "signin_completed",
  "signin_blocked",
  "signout",
  "signout_everywhere",
  "session_revoked",
  "step_up",
  "new_device_alert",
  "turnstile_failed",
  "google_linked",
  "email_verified",
] as const;

export type AuthEventType = (typeof AUTH_EVENT_TYPES)[number];

export interface AuthEventWrite {
  type: AuthEventType;
  customerId?: string | null;
  /** Masked for display — never the full number. */
  maskedPhone?: string | null;
  /** Keyed hash for grouping (session.ts phoneKey). */
  phoneKey?: string | null;
  channel?: string | null;
  ip?: string | null;
  device?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Record an auth event. Never throws: sign-in has already happened (or been
 * refused) by the time its record is written, and a logging fault must not
 * turn into a sign-in fault.
 */
export async function recordAuthEvent(
  pg: SqlClient,
  event: AuthEventWrite,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    await pg.raw(
      `INSERT INTO siumora_auth_event
         (id, type, customer_id, masked_phone, phone_key, channel, ip, device, detail,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?)`,
      [
        newId("siaev"),
        event.type,
        event.customerId ?? null,
        event.maskedPhone ?? null,
        event.phoneKey ?? null,
        event.channel ?? null,
        event.ip ?? null,
        event.device ?? null,
        event.detail ? JSON.stringify(event.detail) : null,
        now.toISOString(),
        now.toISOString(),
      ],
    );
    return true;
  } catch {
    return false;
  }
}

export interface AuthEventRow {
  id: string;
  type: string;
  customer_id: string | null;
  masked_phone: string | null;
  channel: string | null;
  ip: string | null;
  device: string | null;
  detail: unknown;
  created_at: Date | string;
}

export async function readAuthEvents(
  pg: SqlClient,
  query: { customerId?: string; type?: string; limit?: number } = {},
): Promise<AuthEventRow[]> {
  const where = ["deleted_at IS NULL"];
  const bindings: Binding[] = [];
  if (query.customerId) {
    where.push("customer_id = ?");
    bindings.push(query.customerId);
  }
  if (query.type) {
    where.push("type = ?");
    bindings.push(query.type);
  }
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  bindings.push(limit);
  const result = await pg.raw(
    `SELECT id, type, customer_id, masked_phone, channel, ip, device, detail, created_at
       FROM siumora_auth_event
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ?`,
    bindings,
  );
  return result.rows as AuthEventRow[];
}

export interface EventCountRow {
  type: string;
  channel: string | null;
  count: number | string;
}

/** Counts by type and channel since a moment — the sign-in health view. */
export async function countAuthEvents(pg: SqlClient, since: Date): Promise<EventCountRow[]> {
  const result = await pg.raw(
    `SELECT type, channel, count(*) AS count
       FROM siumora_auth_event
      WHERE created_at > ? AND deleted_at IS NULL
      GROUP BY type, channel`,
    [since.toISOString()],
  );
  return result.rows as EventCountRow[];
}

export interface HotspotRow {
  key: string;
  label: string | null;
  count: number | string;
}

/** The networks and numbers hitting the OTP routes hardest — the abuse view.
 *  Grouped by keyed phone hash and coarse IP, never the raw values. */
export async function authHotspots(
  pg: SqlClient,
  since: Date,
  by: "ip" | "phone",
  limit = 20,
): Promise<HotspotRow[]> {
  const column = by === "ip" ? "ip" : "phone_key";
  const label = by === "ip" ? "ip" : "max(masked_phone)";
  const result = await pg.raw(
    `SELECT ${column} AS key, ${label} AS label, count(*) AS count
       FROM siumora_auth_event
      WHERE created_at > ? AND ${column} IS NOT NULL
        AND type IN ('otp_requested', 'otp_failed', 'otp_rate_limited', 'turnstile_failed')
      GROUP BY ${column}
      ORDER BY count(*) DESC
      LIMIT ?`,
    [since.toISOString(), limit],
  );
  return result.rows as HotspotRow[];
}

/** Customers an operator has blocked, newest first. */
export async function listBlocked(pg: SqlClient, limit = 100): Promise<
  Array<{ customer_id: string; blocked_at: string; blocked_reason: string | null; blocked_by: string | null }>
> {
  const result = await pg.raw(
    `SELECT customer_id, blocked_at, blocked_reason, blocked_by
       FROM siumora_customer_security
      WHERE blocked_at IS NOT NULL AND deleted_at IS NULL
      ORDER BY blocked_at DESC
      LIMIT ?`,
    [limit],
  );
  return result.rows as Array<{
    customer_id: string;
    blocked_at: string;
    blocked_reason: string | null;
    blocked_by: string | null;
  }>;
}
