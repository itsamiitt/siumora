import { randomUUID } from "node:crypto";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { slaFor } from "@siumora/core";

import type { SqlClient } from "./data.ts";

/**
 * Data-principal requests, in raw SQL (the Medusa twin of the Fastify
 * openPrivacyRequest / setPrivacyRequestStatus). The erasure itself — the
 * Medusa writes — lives in src/lib/erasure.ts; this file is the ledger.
 */

export type PrivacyKind = "access" | "correction" | "erasure";
export type PrivacyStatus = "received" | "acknowledged" | "completed" | "refused";

export interface PrivacyRequestRow {
  id: string;
  customer_id: string;
  kind: PrivacyKind;
  status: PrivacyStatus;
  note: string | null;
  resolve_by: Date | string;
  completed_at: Date | string | null;
  created_at: Date | string;
}

const COLUMNS = "id, customer_id, kind, status, note, resolve_by, completed_at, created_at";

/**
 * Open a request, or find the one already open. A person who taps twice
 * gets the original deadline, not a fresh one.
 */
export async function openPrivacyRequest(
  pg: SqlClient,
  input: { customerId: string; kind: PrivacyKind; now: Date },
): Promise<{ request: PrivacyRequestRow; existing: boolean }> {
  const open = await pg.raw(
    `SELECT ${COLUMNS} FROM siumora_privacy_request
      WHERE customer_id = ? AND kind = ? AND status IN ('received', 'acknowledged')
        AND deleted_at IS NULL
      ORDER BY created_at ASC LIMIT 1`,
    [input.customerId, input.kind],
  );
  const found = open.rows[0] as PrivacyRequestRow | undefined;
  if (found) return { request: found, existing: true };

  const id = `sipr_${randomUUID().replaceAll("-", "")}`;
  const resolveBy = (slaFor(input.now) as { resolveBy: Date }).resolveBy;
  const inserted = await pg.raw(
    `INSERT INTO siumora_privacy_request
       (id, customer_id, kind, status, resolve_by, created_at, updated_at)
     VALUES (?, ?, ?, 'received', ?, ?, ?)
     RETURNING ${COLUMNS}`,
    [id, input.customerId, input.kind, resolveBy.toISOString(), input.now.toISOString(), input.now.toISOString()],
  );
  return { request: inserted.rows[0] as PrivacyRequestRow, existing: false };
}

export async function setPrivacyStatus(
  pg: SqlClient,
  id: string,
  status: PrivacyStatus,
  now: Date,
  note?: string,
): Promise<void> {
  await pg.raw(
    `UPDATE siumora_privacy_request
        SET status = ?, note = COALESCE(?, note), completed_at = ?, updated_at = ?
      WHERE id = ?`,
    [
      status,
      note ?? null,
      status === "completed" || status === "refused" ? now.toISOString() : null,
      now.toISOString(),
      id,
    ],
  );
}

/** The open queue, oldest deadline first — what an operator works through. */
export async function openPrivacyQueue(pg: SqlClient, limit = 100): Promise<PrivacyRequestRow[]> {
  const result = await pg.raw(
    `SELECT ${COLUMNS} FROM siumora_privacy_request
      WHERE status IN ('received', 'acknowledged') AND deleted_at IS NULL
      ORDER BY resolve_by ASC LIMIT ?`,
    [limit],
  );
  return result.rows as PrivacyRequestRow[];
}

/** Strip the phone traces from this customer's auth events once erased. */
export async function forgetAuthEvents(pg: SqlClient, customerId: string): Promise<void> {
  await pg.raw(
    `UPDATE siumora_auth_event
        SET masked_phone = NULL, phone_key = NULL, updated_at = now()
      WHERE customer_id = ?`,
    [customerId],
  );
}
