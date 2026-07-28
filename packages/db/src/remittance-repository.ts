import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

import {
  cashPosition,
  overDeducted,
  reconcileRemittance,
  type CashPosition,
  type ExpectedOrder,
  type ReconciliationSummary,
  type RemittanceRow,
} from "@siumora/core";

import type { Database } from "./client.ts";
import { codRemittances, orders } from "./schema.ts";

/**
 * COD remittance ingestion.
 *
 * The arithmetic lives in `@siumora/core` and is tested without a database.
 * What is here is the part that needs one: fetching what the shop believes
 * about each order, and writing the outcome down so the next batch cannot
 * credit the same order again.
 */

/** Outcomes that mean this order's money has been accounted for. */
export const SETTLED_OUTCOMES = ["matched", "short", "over"] as const;

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
 * Reconcile a batch and record it.
 *
 * Re-uploading the same file is a no-op: the unique index on
 * `(batch_id, order_number)` absorbs the second write, and the outcomes come
 * back unchanged rather than turning into a wall of duplicates. Rows from
 * *other* batches are what make an order already-reconciled — excluding the
 * batch being ingested is what keeps a replay honest.
 */
export async function ingestRemittanceBatch(
  db: Database,
  batch: RemittanceBatch,
): Promise<IngestResult> {
  const numbers = [...new Set(batch.rows.map((row) => row.orderNumber))];

  const matched = numbers.length
    ? await db
        .select({
          id: orders.id,
          number: orders.number,
          total: orders.total,
          paymentMethod: orders.paymentMethod,
          status: orders.status,
        })
        .from(orders)
        .where(inArray(orders.number, numbers))
    : [];

  const settledElsewhere = numbers.length
    ? await db
        .select({ orderNumber: codRemittances.orderNumber })
        .from(codRemittances)
        .where(
          and(
            inArray(codRemittances.orderNumber, numbers),
            ne(codRemittances.batchId, batch.batchId),
            inArray(codRemittances.outcome, [...SETTLED_OUTCOMES]),
          ),
        )
    : [];

  const alreadyReconciled = new Set(
    settledElsewhere.map((row) => row.orderNumber),
  );

  const expected: ExpectedOrder[] = matched.map((row) => ({
    orderNumber: row.number,
    total: row.total,
    paymentMethod: row.paymentMethod,
    status: row.status as ExpectedOrder["status"],
    alreadyReconciled: alreadyReconciled.has(row.number),
  }));

  const summary = reconcileRemittance(batch.rows, expected);
  const idByNumber = new Map(matched.map((row) => [row.number, row.id]));

  const written = summary.rows.length
    ? await db
        .insert(codRemittances)
        .values(
          summary.rows.map((entry) => ({
            batchId: batch.batchId,
            courier: batch.courier,
            orderNumber: entry.row.orderNumber,
            orderId: idByNumber.get(entry.row.orderNumber) ?? null,
            collected: entry.row.collected,
            deductions: entry.row.deductions,
            remitted: entry.row.remitted,
            declaredWeightGrams: entry.row.declaredWeightGrams ?? null,
            chargedWeightGrams: entry.row.chargedWeightGrams ?? null,
            outcome: entry.outcome,
            variance: entry.variance,
            note: entry.note ?? null,
            remittedOn: batch.remittedOn ?? null,
          })),
        )
        // The second upload of a file is a replay, not a correction: keeping the
        // original row preserves what was actually claimed at the time.
        .onConflictDoNothing()
        .returning({ id: codRemittances.id })
    : [];

  return {
    ...summary,
    batchId: batch.batchId,
    recorded: written.length,
    deductionAlarms: overDeducted(batch.rows),
  };
}

export type RemittanceLedgerRow = typeof codRemittances.$inferSelect;

/** Recorded rows, newest batch first. Filtered to one batch when asked. */
export async function remittanceLedger(
  db: Database,
  options: { batchId?: string; limit?: number } = {},
): Promise<RemittanceLedgerRow[]> {
  const query = db.select().from(codRemittances);
  const rows = options.batchId
    ? await query
        .where(eq(codRemittances.batchId, options.batchId))
        .orderBy(desc(codRemittances.reconciledAt))
        .limit(options.limit ?? 500)
    : await query
        .orderBy(desc(codRemittances.reconciledAt))
        .limit(options.limit ?? 500);
  return rows;
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
  readonly reconciledAt: Date;
}

/** One line per batch, for the panel an operator scans before drilling in. */
export async function remittanceBatches(
  db: Database,
  limit = 50,
): Promise<BatchSummary[]> {
  const { rows } = await db.execute(sql`
    SELECT batch_id                                             AS "batchId",
           min(courier)                                         AS courier,
           count(*)::int                                        AS "rows",
           coalesce(sum(collected), 0)::int                     AS collected,
           coalesce(sum(deductions), 0)::int                    AS deductions,
           coalesce(sum(remitted), 0)::int                      AS remitted,
           coalesce(sum(CASE WHEN outcome = 'short'
                             THEN -variance ELSE 0 END), 0)::int AS shortfall,
           count(*) FILTER (WHERE outcome <> 'matched')::int    AS exceptions,
           max(reconciled_at)                                   AS "reconciledAt"
    FROM cod_remittances
    GROUP BY batch_id
    ORDER BY max(reconciled_at) DESC
    LIMIT ${limit}
  `);
  return rows as unknown as BatchSummary[];
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
  readonly reconciledAt: Date;
}

/**
 * Exceptions still open across every batch.
 *
 * The queue an operator actually works. Ordered worst first by the same
 * severity the reconciler uses — money missing outranks a keying error.
 */
export async function openRemittanceExceptions(
  db: Database,
  limit = 100,
): Promise<RemittanceException[]> {
  // Columns are aliased rather than selected with *: raw SQL comes back in the
  // database's snake_case, and a caller reading `orderNumber` off it gets
  // undefined — which renders as a blank line instead of an error.
  const { rows } = await db.execute(sql`
    SELECT id,
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
    FROM cod_remittances
    WHERE outcome <> 'matched'
    ORDER BY CASE outcome
               WHEN 'short' THEN 0
               WHEN 'unknown_order' THEN 1
               WHEN 'not_delivered' THEN 2
               WHEN 'duplicate' THEN 3
               WHEN 'not_cod' THEN 4
               ELSE 5
             END,
             reconciled_at DESC
    LIMIT ${limit}
  `);
  return rows as unknown as RemittanceException[];
}

/**
 * Where the money is today.
 *
 * The join matters: an order is "remitted" only when a settled remittance row
 * exists for it. Reading the order status alone would count every delivered COD
 * parcel as paid, which is exactly the number that is wrong.
 */
export async function currentCashPosition(db: Database): Promise<CashPosition> {
  const { rows } = await db.execute(sql`
    SELECT o.total, o.payment_method AS "paymentMethod", o.status,
           EXISTS (
             SELECT 1 FROM cod_remittances r
             WHERE r.order_number = o.number
               AND r.outcome IN ('matched', 'short', 'over')
           ) AS reconciled
    FROM orders o
  `);

  return cashPosition(
    rows as unknown as Array<{
      total: number;
      paymentMethod: string;
      status: ExpectedOrder["status"];
      reconciled: boolean;
    }>,
  );
}
