import { randomUUID } from "node:crypto";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { overDeducted, reconcileRemittance, type ExpectedOrder, type ReconciliationSummary, type RemittanceRow } from "@siumora/core";

/**
 * The remittance write/read path, in raw SQL against the shared pg
 * connection — the Medusa twin of packages/db/src/remittance-repository.ts,
 * with the same split: the arithmetic (reconcileRemittance, cashPosition,
 * overDeducted) is core's and tested without a database; what is here is
 * fetching what the shop believes and writing the verdicts down so the next
 * batch cannot credit the same order again.
 *
 * The caller supplies ExpectedOrder[] (built from loadDomainOrders — the
 * SIU identity, status row and computed paise totals), because "what the
 * shop believes about an order" is assembled order truth, not a table this
 * module owns.
 */

/** Structural slice of knex so this file needs no knex type dependency. */
export interface SqlClient {
  raw(
    sql: string,
    bindings: ReadonlyArray<string | number | boolean | null>,
  ): Promise<{ rows: unknown[] }>;
}

/** Outcomes that mean this order's money has been accounted for. */
export const SETTLED_OUTCOMES = ["matched", "short", "over"] as const;

const SETTLED_SQL = SETTLED_OUTCOMES.map((outcome) => `'${outcome}'`).join(", ");

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export interface RemittanceBatch {
  readonly batchId: string;
  readonly courier: string;
  /** When the courier says it paid — not when we reconciled. */
  readonly remittedOn?: Date;
  readonly rows: readonly RemittanceRow[];
}

export interface IngestResult extends ReconciliationSummary {
  readonly batchId: string;
  /** Rows written. Zero on a re-upload, which is how a replay is recognised. */
  readonly recorded: number;
  /** Rows where the courier kept an implausible share of the collection. */
  readonly deductionAlarms: readonly RemittanceRow[];
}

/**
 * Order numbers already settled by a DIFFERENT batch. Rows from other
 * batches are what make an order already-reconciled — excluding the batch
 * being ingested is what keeps a replay honest.
 */
export async function settledElsewhere(
  client: SqlClient,
  orderNumbers: readonly string[],
  batchId: string,
): Promise<Set<string>> {
  if (orderNumbers.length === 0) return new Set();
  const result = await client.raw(
    `SELECT DISTINCT order_number FROM siumora_cod_remittances
      WHERE order_number IN (${placeholders(orderNumbers.length)})
        AND batch_id <> ?
        AND outcome IN (${SETTLED_SQL})
        AND deleted_at IS NULL`,
    [...orderNumbers, batchId],
  );
  return new Set(
    (result.rows as Array<{ order_number: string }>).map((row) => row.order_number),
  );
}

/** Order numbers with a settled remittance row — for the cash position. */
export async function reconciledOrderNumbers(
  client: SqlClient,
): Promise<Set<string>> {
  const result = await client.raw(
    `SELECT DISTINCT order_number FROM siumora_cod_remittances
      WHERE outcome IN (${SETTLED_SQL}) AND deleted_at IS NULL`,
    [],
  );
  return new Set(
    (result.rows as Array<{ order_number: string }>).map((row) => row.order_number),
  );
}

/**
 * Reconcile a batch and record it. Re-uploading the same file is a no-op:
 * the unique index on (batch_id, order_number) absorbs the second write and
 * the outcomes come back unchanged rather than turning into duplicates.
 */
export async function ingestRemittanceBatch(
  client: SqlClient,
  batch: RemittanceBatch,
  expected: readonly ExpectedOrder[],
  orderIdByNumber: ReadonlyMap<string, string>,
): Promise<IngestResult> {
  const summary = reconcileRemittance(batch.rows, expected);

  let recorded = 0;
  for (const entry of summary.rows) {
    const result = await client.raw(
      `INSERT INTO siumora_cod_remittances
         (id, batch_id, courier, order_number, order_id, collected, deductions,
          remitted, declared_weight_grams, charged_weight_grams, outcome,
          variance, note, remitted_on, reconciled_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now(), now())
       ON CONFLICT (batch_id, order_number) DO NOTHING
       RETURNING id`,
      [
        `sirem_${randomUUID().replaceAll("-", "")}`,
        batch.batchId,
        batch.courier,
        entry.row.orderNumber,
        orderIdByNumber.get(entry.row.orderNumber) ?? null,
        entry.row.collected,
        entry.row.deductions,
        entry.row.remitted,
        entry.row.declaredWeightGrams ?? null,
        entry.row.chargedWeightGrams ?? null,
        entry.outcome,
        entry.variance,
        entry.note ?? null,
        batch.remittedOn ? batch.remittedOn.toISOString() : null,
      ],
    );
    // The second upload of a file is a replay, not a correction: the
    // original row preserves what was actually claimed at the time.
    if (result.rows.length > 0) recorded += 1;
  }

  return {
    ...summary,
    batchId: batch.batchId,
    recorded,
    deductionAlarms: overDeducted(batch.rows),
  };
}

export interface BatchSummary {
  readonly batchId: string;
  readonly courier: string;
  readonly rows: number;
  readonly collected: number;
  readonly deductions: number;
  readonly remitted: number;
  /** Money still owed on this batch, as a positive number. */
  readonly shortfall: number;
  readonly exceptions: number;
  readonly reconciledAt: Date | string;
}

/** One line per batch, for the panel an operator scans before drilling in. */
export async function remittanceBatches(
  client: SqlClient,
  limit = 50,
): Promise<BatchSummary[]> {
  const result = await client.raw(
    `SELECT batch_id                                              AS "batchId",
            min(courier)                                          AS courier,
            count(*)::int                                         AS "rows",
            coalesce(sum(collected), 0)::int                      AS collected,
            coalesce(sum(deductions), 0)::int                     AS deductions,
            coalesce(sum(remitted), 0)::int                       AS remitted,
            coalesce(sum(CASE WHEN outcome = 'short'
                              THEN -variance ELSE 0 END), 0)::int AS shortfall,
            count(*) FILTER (WHERE outcome <> 'matched')::int     AS exceptions,
            max(reconciled_at)                                    AS "reconciledAt"
     FROM siumora_cod_remittances
     WHERE deleted_at IS NULL
     GROUP BY batch_id
     ORDER BY max(reconciled_at) DESC
     LIMIT ?`,
    [limit],
  );
  return result.rows as BatchSummary[];
}

/** An exception as the queue shows it — camelCase, whatever the columns say. */
export interface RemittanceException {
  readonly id: string;
  readonly batchId: string;
  readonly courier: string;
  readonly orderNumber: string;
  readonly collected: number;
  readonly deductions: number;
  readonly remitted: number;
  readonly outcome: string;
  readonly variance: number;
  readonly note: string | null;
  /** Null when the file carried no weights, which is not the same as zero. */
  readonly excessWeightGrams: number | null;
  readonly reconciledAt: Date | string;
}

/**
 * Exceptions still open across every batch, worst first by the same
 * severity the reconciler uses — money missing outranks a keying error.
 */
export async function openRemittanceExceptions(
  client: SqlClient,
  limit = 100,
): Promise<RemittanceException[]> {
  const result = await client.raw(
    `SELECT id,
            batch_id            AS "batchId",
            courier,
            order_number        AS "orderNumber",
            collected,
            deductions,
            remitted,
            outcome,
            variance,
            note,
            charged_weight_grams - declared_weight_grams AS "excessWeightGrams",
            reconciled_at       AS "reconciledAt"
     FROM siumora_cod_remittances
     WHERE outcome <> 'matched' AND deleted_at IS NULL
     ORDER BY CASE outcome
                WHEN 'short' THEN 0
                WHEN 'unknown_order' THEN 1
                WHEN 'not_delivered' THEN 2
                WHEN 'duplicate' THEN 3
                WHEN 'not_cod' THEN 4
                ELSE 5
              END,
              reconciled_at DESC
     LIMIT ?`,
    [limit],
  );
  return result.rows as RemittanceException[];
}

/** Recorded rows for one batch, newest first. */
export async function remittanceLedger(
  client: SqlClient,
  batchId: string,
  limit = 500,
): Promise<unknown[]> {
  const result = await client.raw(
    `SELECT * FROM siumora_cod_remittances
      WHERE batch_id = ? AND deleted_at IS NULL
      ORDER BY reconciled_at DESC
      LIMIT ?`,
    [batchId, limit],
  );
  return result.rows;
}
