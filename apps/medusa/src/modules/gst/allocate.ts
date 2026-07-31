import { randomUUID } from "node:crypto";

import { INVOICE_NUMBER_SQL, type GstInvoiceRow } from "./invoice";

/**
 * The statutory-series write path, in raw SQL against the shared pg
 * connection (ContainerRegistrationKeys.PG_CONNECTION — a knex client).
 *
 * Why raw SQL and not the module service: the sequence draw, the number
 * formatting and the row insert must be ONE atomic statement, exactly like
 * siumora-order's allocate.ts — split across a read and a create() there is
 * a window where a crash issues a number without a row.
 *
 * Concurrency disposition (also written into the module migration):
 * - The sequence is `COALESCE(MAX(sequence),0)+1` scoped to the financial
 *   year, drawn INSIDE the INSERT's FROM clause. Deliberately not nextval():
 *   a Postgres sequence burns a value on rollback, and a statutory series
 *   must not gap. Because the draw writes nothing on refusal, a refused or
 *   rolled-back insert leaves the series exactly where it was.
 * - Two concurrent draws would both compute the same MAX+1, so the INSERT
 *   runs inside a transaction that first takes
 *   `LOCK TABLE gst_invoice IN SHARE ROW EXCLUSIVE MODE` — the same-table
 *   allocation lock (the module-local twin of the Fastify invoicing.ts
 *   lock). The lock self-conflicts, serialising issuers; reads pass freely.
 * - Even if the lock were somehow bypassed, the partial unique index on
 *   (financial_year, sequence) makes double-issue impossible by
 *   construction — the loser errors, nothing is written, no gap appears.
 * - `ON CONFLICT (order_id) WHERE deleted_at IS NULL DO NOTHING` (matching
 *   the partial unique index the migration created) makes the issue
 *   idempotent per order: the complete route, its replays, and any future
 *   subscriber can race and exactly one invoice wins; losers re-read the
 *   winner. Crucially the losing INSERT writes nothing, so — unlike the
 *   order-number sequence — losing this race burns no number.
 */

/** Structural slice of knex so this file needs no knex type dependency. */
export interface GstSqlClient {
  raw(
    sql: string,
    bindings: ReadonlyArray<string | number | boolean | null>,
  ): Promise<{ rows: GstInvoiceRow[] }>;
}

/** A client that can open a transaction (knex.transaction). The allocation
 * needs one: the same-table lock and the INSERT must share a transaction. */
export interface GstTxClient extends GstSqlClient {
  transaction<T>(handler: (trx: GstSqlClient) => Promise<T>): Promise<T>;
}

const COLUMNS =
  'id, order_id, financial_year, "sequence", invoice_number, buyer_gstin, interstate, "rows", totals, created_at';

export async function findInvoiceByOrderId(
  client: GstSqlClient,
  orderId: string,
): Promise<GstInvoiceRow | undefined> {
  const result = await client.raw(
    `SELECT ${COLUMNS} FROM gst_invoice WHERE order_id = ? AND deleted_at IS NULL`,
    [orderId],
  );
  return result.rows[0];
}

export interface AllocateInvoiceInput {
  orderId: string;
  /** Core financialYear() label the sequence is scoped to, e.g. "2026-27". */
  financialYear: string;
  buyerGstin: string | null;
  interstate: boolean;
  /** Core HsnSummaryRow[] — already asserted to re-add (invoice.ts). */
  rows: unknown;
  /** Core InvoiceTotals — already asserted to re-add (invoice.ts). */
  totals: unknown;
}

export type InvoiceAllocationResult = {
  kind: "issued" | "existing";
  invoice: GstInvoiceRow;
};

/**
 * Issue (or find) the statutory invoice for a completed order.
 *
 * Exactly one row per order ever exists, and within a financial year every
 * row takes the next gapless sequence value; see the file comment for how
 * each race resolves.
 */
export async function allocateInvoice(
  client: GstTxClient,
  input: AllocateInvoiceInput,
): Promise<InvoiceAllocationResult> {
  const existing = await findInvoiceByOrderId(client, input.orderId);
  if (existing) return { kind: "existing", invoice: existing };

  const id = `gsinv_${randomUUID().replaceAll("-", "")}`;
  const inserted = await client.transaction(async (trx) => {
    // The same-table allocation lock: serialises concurrent draws so the
    // MAX+1 below is race-free. Self-conflicting; plain reads pass.
    await trx.raw("LOCK TABLE gst_invoice IN SHARE ROW EXCLUSIVE MODE", []);
    const result = await trx.raw(
      `INSERT INTO gst_invoice
         (id, order_id, financial_year, "sequence", invoice_number,
          buyer_gstin, interstate, "rows", totals, created_at, updated_at)
       SELECT ?, ?, ?, next.seq, ${INVOICE_NUMBER_SQL},
              ?, ?, ?::jsonb, ?::jsonb, now(), now()
         FROM (
           SELECT COALESCE(MAX("sequence"), 0) + 1 AS seq
             FROM gst_invoice
            WHERE financial_year = ? AND deleted_at IS NULL
         ) AS next
       ON CONFLICT (order_id) WHERE deleted_at IS NULL DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        id,
        input.orderId,
        input.financialYear,
        input.financialYear,
        input.buyerGstin,
        input.interstate,
        JSON.stringify(input.rows),
        JSON.stringify(input.totals),
        input.financialYear,
      ],
    );
    return result.rows[0];
  });

  if (inserted) return { kind: "issued", invoice: inserted };

  // Lost the per-order race — the winner's row IS the invoice, and losing
  // burned nothing from the series (the refused INSERT wrote no row).
  const winner = await findInvoiceByOrderId(client, input.orderId);
  if (!winner) {
    // ON CONFLICT DO NOTHING returned nothing AND no row exists: only a
    // concurrent hard-delete could produce this. Surface it loudly.
    throw new Error(
      `invoice allocation for order ${input.orderId} found neither insert nor row`,
    );
  }
  return { kind: "existing", invoice: winner };
}
