import { randomUUID } from "node:crypto";

import type { ReturnRow } from "./lifecycle";

/**
 * The returns-ndr write/read path, in raw SQL against the shared pg
 * connection (ContainerRegistrationKeys.PG_CONNECTION — a knex client), the
 * same disposition as siumora-order/allocate.ts and for the same reason: the
 * guarantees live in the database. The lazy status insert is one atomic
 * ON CONFLICT statement, and the one-open-return rule is a partial unique
 * index (migration) surfacing here as a caught 23505 — never a read-then-
 * write window.
 *
 * STATUS-ROW LAZY-INIT, the decision written down (task item 2): the natural
 * place to insert the status row is the completion route, but that file is
 * owned by a sibling work item. So the row is created lazily — on the FIRST
 * read or write any of this module's routes makes — via INSERT ... ON
 * CONFLICT DO NOTHING seeded from initialSiumoraStatus (confirmed-unless-
 * cancelled, the exact status the sibling read maps a fresh COD order to).
 * Correctness does not depend on who inserts first: the ON CONFLICT arbiter
 * (the partial unique index on order_id) makes every racer converge on one
 * row, and a later wiring of the complete route can funnel through this same
 * ensureStatusRow unchanged. Until then, this table IS the status truth the
 * storefront reads; Medusa's own fulfillment statuses arrive with real
 * couriers in M3.
 */

/** Structural slice of knex so this file needs no knex type dependency. */
export interface SqlClient {
  raw(
    sql: string,
    bindings: ReadonlyArray<string | number | boolean | null>,
  ): Promise<{ rows: unknown[] }>;
}

function mintId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}

// ── siumora_order_status ──────────────────────────────────────

export interface StatusRow {
  id: string;
  order_id: string;
  status: string;
  ndr_reason: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

const STATUS_COLUMNS = "id, order_id, status, ndr_reason, created_at, updated_at";

export async function getStatusRow(
  client: SqlClient,
  orderId: string,
): Promise<StatusRow | undefined> {
  const result = await client.raw(
    `SELECT ${STATUS_COLUMNS} FROM siumora_order_status
      WHERE order_id = ? AND deleted_at IS NULL`,
    [orderId],
  );
  return result.rows[0] as StatusRow | undefined;
}

/**
 * Find-or-create the status row (see the file comment for why lazily).
 * The ON CONFLICT predicate matches the partial unique index the migration
 * created, so concurrent first-touches converge on one row; the loser
 * re-reads the winner.
 */
export async function ensureStatusRow(
  client: SqlClient,
  orderId: string,
  initialStatus: string,
): Promise<StatusRow> {
  const inserted = await client.raw(
    `INSERT INTO siumora_order_status (id, order_id, status, ndr_reason, created_at, updated_at)
     VALUES (?, ?, ?, NULL, now(), now())
     ON CONFLICT (order_id) WHERE deleted_at IS NULL DO NOTHING
     RETURNING ${STATUS_COLUMNS}`,
    [mintId("siost"), orderId, initialStatus],
  );
  if (inserted.rows[0]) return inserted.rows[0] as StatusRow;

  const existing = await getStatusRow(client, orderId);
  if (!existing) {
    // DO NOTHING returned nothing AND no live row exists: only a concurrent
    // hard-delete could produce this. Surface it loudly.
    throw new Error(`status row for order ${orderId} found neither insert nor row`);
  }
  return existing;
}

/**
 * Write a transition the caller has already validated with core's
 * canTransition. COALESCE keeps the stored NDR reason when none is passed —
 * Fastify's advance() likewise never clears a reason, so the last failure
 * stays readable on an order that recovered.
 */
export async function setStatus(
  client: SqlClient,
  orderId: string,
  status: string,
  ndrReason?: string,
): Promise<StatusRow> {
  const result = await client.raw(
    `UPDATE siumora_order_status
        SET status = ?, ndr_reason = COALESCE(?, ndr_reason), updated_at = now()
      WHERE order_id = ? AND deleted_at IS NULL
      RETURNING ${STATUS_COLUMNS}`,
    [status, ndrReason ?? null, orderId],
  );
  const row = result.rows[0] as StatusRow | undefined;
  if (!row) throw new Error(`no status row to update for order ${orderId}`);
  return row;
}

// ── siumora_ndr_events ────────────────────────────────────────

export interface NdrEventRow {
  id: string;
  order_id: string;
  reason: string;
  attempt: number;
  action: string | null;
  created_at: string | Date;
}

const NDR_COLUMNS = "id, order_id, reason, attempt, action, created_at";

/**
 * Attempts already made = events already recorded (one row is inserted per
 * failed attempt, below). Fastify stores a delivery_attempts counter on the
 * order row; deriving it from the event log is the same number without a
 * second copy to drift.
 */
export async function countNdrAttempts(
  client: SqlClient,
  orderId: string,
): Promise<number> {
  const result = await client.raw(
    `SELECT count(*)::int AS n FROM siumora_ndr_events
      WHERE order_id = ? AND deleted_at IS NULL`,
    [orderId],
  );
  return (result.rows[0] as { n: number }).n;
}

export async function insertNdrEvent(
  client: SqlClient,
  input: { orderId: string; reason: string; attempt: number },
): Promise<NdrEventRow> {
  const result = await client.raw(
    `INSERT INTO siumora_ndr_events (id, order_id, reason, attempt, action, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, now(), now())
     RETURNING ${NDR_COLUMNS}`,
    [mintId("sindr"), input.orderId, input.reason, input.attempt],
  );
  return result.rows[0] as unknown as NdrEventRow;
}

/**
 * Record the customer's answer on the latest failed attempt. Called only
 * once the answer is accepted, so the log reads as what actually happened —
 * an answer the route refused (not_recoverable) is not an event.
 */
export async function recordNdrAction(
  client: SqlClient,
  orderId: string,
  action: string,
): Promise<NdrEventRow | undefined> {
  const result = await client.raw(
    `UPDATE siumora_ndr_events
        SET action = ?, updated_at = now()
      WHERE id = (
        SELECT id FROM siumora_ndr_events
         WHERE order_id = ? AND deleted_at IS NULL
         ORDER BY attempt DESC, created_at DESC
         LIMIT 1
      )
      RETURNING ${NDR_COLUMNS}`,
    [action, orderId],
  );
  return result.rows[0] as NdrEventRow | undefined;
}

// ── siumora_return_requests ───────────────────────────────────

const RETURN_COLUMNS =
  "id, order_id, status, reason, resolution, variant_ids, refund_to, free_return_shipping, seal_intact, note, created_at";

export type ReturnInsert =
  | { kind: "created"; row: ReturnRow }
  | { kind: "already_open" };

/**
 * Insert a return request. The partial unique index
 * (order_id WHERE status <> 'rejected') refuses a second open return on one
 * order — which would otherwise refund the same piece twice — and that
 * refusal surfaces here as 23505 → "already_open" for the route's 409.
 */
export async function insertReturnRequest(
  client: SqlClient,
  input: {
    orderId: string;
    status: string;
    reason: string;
    resolution: string;
    variantIds: readonly string[];
    refundTo: string;
    freeReturnShipping: boolean;
    sealIntact: boolean | null;
    note: string | null;
  },
): Promise<ReturnInsert> {
  try {
    const result = await client.raw(
      `INSERT INTO siumora_return_requests
         (id, order_id, status, reason, resolution, variant_ids, refund_to, free_return_shipping, seal_intact, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, now(), now())
       RETURNING ${RETURN_COLUMNS}`,
      [
        mintId("siret"),
        input.orderId,
        input.status,
        input.reason,
        input.resolution,
        JSON.stringify(input.variantIds),
        input.refundTo,
        input.freeReturnShipping,
        input.sealIntact,
        input.note,
      ],
    );
    return { kind: "created", row: result.rows[0] as unknown as ReturnRow };
  } catch (error) {
    if (isUniqueViolation(error)) return { kind: "already_open" };
    throw error;
  }
}

export async function findOpenReturn(
  client: SqlClient,
  orderId: string,
): Promise<ReturnRow | undefined> {
  const result = await client.raw(
    `SELECT ${RETURN_COLUMNS} FROM siumora_return_requests
      WHERE order_id = ? AND status <> 'rejected' AND deleted_at IS NULL`,
    [orderId],
  );
  return result.rows[0] as ReturnRow | undefined;
}
