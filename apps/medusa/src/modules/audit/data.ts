import { randomUUID } from "node:crypto";

import type { AuditRow } from "./audit";

/**
 * The audit write/read path, in raw SQL against the shared pg connection
 * (ContainerRegistrationKeys.PG_CONNECTION — a knex client), the same
 * disposition as returns-ndr/data.ts.
 *
 * The write never throws to its caller: an action that succeeded must not be
 * rolled back because its record failed — the Fastify audit() has the same
 * posture (log the failure, keep the response). The caller passes a logger.
 */

/** Structural slice of knex so this file needs no knex type dependency. */
export interface SqlClient {
  raw(
    sql: string,
    bindings: ReadonlyArray<string | number | boolean | null>,
  ): Promise<{ rows: unknown[] }>;
}

const COLUMNS =
  "id, actor_id, actor_contact, actor_role, action, subject, detail, ip, created_at";

export interface AuditWrite {
  actorId: string | null;
  actorContact: string;
  actorRole: string;
  action: string;
  subject?: string;
  detail?: unknown;
  ip?: string;
}

export async function recordAudit(
  client: SqlClient,
  entry: AuditWrite,
): Promise<{ recorded: boolean; error?: unknown }> {
  try {
    await client.raw(
      `INSERT INTO siumora_audit_log
         (id, actor_id, actor_contact, actor_role, action, subject, detail, ip, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, now(), now())`,
      [
        `siaud_${randomUUID().replaceAll("-", "")}`,
        entry.actorId,
        entry.actorContact,
        entry.actorRole,
        entry.action,
        entry.subject ?? null,
        entry.detail === undefined ? null : JSON.stringify(entry.detail),
        entry.ip ?? null,
      ],
    );
    return { recorded: true };
  } catch (error) {
    return { recorded: false, error };
  }
}

export interface AuditQuery {
  readonly action?: string;
  readonly subject?: string;
  readonly limit?: number;
}

/** Most recent first, which is the only order anybody reads a log in. */
export async function readAudit(
  client: SqlClient,
  query: AuditQuery = {},
): Promise<AuditRow[]> {
  const where: string[] = ["deleted_at IS NULL"];
  const bindings: Array<string | number> = [];
  if (query.action) {
    where.push("action = ?");
    bindings.push(query.action);
  }
  if (query.subject) {
    where.push("subject = ?");
    bindings.push(query.subject);
  }
  bindings.push(query.limit ?? 200);

  const result = await client.raw(
    `SELECT ${COLUMNS} FROM siumora_audit_log
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ?`,
    bindings,
  );
  return result.rows as AuditRow[];
}
