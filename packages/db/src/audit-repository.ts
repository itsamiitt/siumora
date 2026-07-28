import { and, desc, eq } from "drizzle-orm";

import type { AuditAction, Role } from "@siumora/core";

import type { Database } from "./client.ts";
import { auditLog } from "./schema.ts";

/**
 * The audit log.
 *
 * Writes only ever append; the database refuses an update or a delete outright,
 * so there is no function here that could try.
 */

export type AuditRow = typeof auditLog.$inferSelect;

export interface AuditEntry {
  readonly actorId?: string | null;
  readonly actorPhone: string;
  readonly actorRole: Role;
  readonly action: AuditAction;
  readonly subject?: string;
  readonly detail?: unknown;
  readonly ip?: string;
}

/**
 * Record an action.
 *
 * Never throws into the caller. An order that was genuinely cancelled must not
 * be un-cancelled because the log was unreachable — the write has already
 * happened, and refusing it after the fact would leave the two disagreeing in
 * the worse direction. A failure is returned so the caller can shout about it.
 */
export async function recordAudit(
  db: Database,
  entry: AuditEntry,
): Promise<{ recorded: boolean; error?: unknown }> {
  try {
    await db.insert(auditLog).values({
      actorId: entry.actorId ?? null,
      actorPhone: entry.actorPhone,
      actorRole: entry.actorRole,
      action: entry.action,
      subject: entry.subject ?? null,
      detail: entry.detail ?? null,
      ip: entry.ip ?? null,
    });
    return { recorded: true };
  } catch (error) {
    return { recorded: false, error };
  }
}

export interface AuditQuery {
  readonly action?: AuditAction;
  readonly actorPhone?: string;
  readonly subject?: string;
  readonly limit?: number;
}

/** Most recent first, which is the only order anybody reads a log in. */
export async function readAudit(
  db: Database,
  query: AuditQuery = {},
): Promise<AuditRow[]> {
  const filters = [
    query.action ? eq(auditLog.action, query.action) : undefined,
    query.actorPhone ? eq(auditLog.actorPhone, query.actorPhone) : undefined,
    query.subject ? eq(auditLog.subject, query.subject) : undefined,
  ].filter((filter) => filter !== undefined);

  const rows = filters.length
    ? await db
        .select()
        .from(auditLog)
        .where(and(...filters))
        .orderBy(desc(auditLog.createdAt))
        .limit(query.limit ?? 200)
    : await db
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.createdAt))
        .limit(query.limit ?? 200);

  return rows;
}
