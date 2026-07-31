import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * gst_invoices — the statutory series, and where each of its guarantees now
 * lives (design doc M2 "the invariant question, answered not assumed").
 *
 * DISPOSITION, written down as the design doc demands:
 *
 * - **Series integrity is DATABASE-enforced, module-locally.** The partial
 *   unique index on (financial_year, sequence) makes double-issue within a
 *   year impossible whatever process writes; the unique order_id makes a
 *   second invoice for one order impossible (idempotent issue); the unique
 *   invoice_number is the belt over both. The sequence itself is drawn as
 *   `COALESCE(MAX(sequence),0)+1` INSIDE the allocation INSERT (allocate.ts),
 *   serialised by `LOCK TABLE gst_invoice IN SHARE ROW EXCLUSIVE MODE` in the
 *   same transaction — the same-table allocation lock. A refused or rolled-
 *   back insert writes nothing and therefore burns nothing: the series cannot
 *   gap on a race. (Deliberately NOT a Postgres sequence: nextval burns a
 *   value on rollback, which order numbers may tolerate and a statutory
 *   invoice series may not.)
 * - **Cross-table money checks do NOT survive as constraints.** The Fastify
 *   schema could CHECK totals against its own orders table; this module may
 *   not reach into Medusa's. Replacement, stated plainly: an application-
 *   level assertion at write time (invoice.ts assertInvoiceReconciles — rows
 *   re-add to totals, totals re-add to the order's goods value, tax heads
 *   respect interstate; the write is REFUSED on drift) plus a daily
 *   reconciliation that proves books against Medusa's order totals and
 *   alarms.
 *   TODO(gst-recon-daily): the reconciliation job is M2's separate recon
 *   work-item — it extends the existing recon pattern over this table; this
 *   named hook is where it plugs in. Do not treat the write-time assertion
 *   as a substitute for it.
 */
export class Migration20260731130000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "gst_invoice" ("id" text not null, "order_id" text not null, "financial_year" text not null, "sequence" integer not null, "invoice_number" text not null, "buyer_gstin" text null, "interstate" boolean not null, "rows" jsonb not null, "totals" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "gst_invoice_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_gst_invoice_order_id_unique" ON "gst_invoice" ("order_id") WHERE deleted_at IS NULL;`);
    // The FY-unique partial index: the statutory guarantee itself.
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_gst_invoice_series_unique" ON "gst_invoice" ("financial_year", "sequence") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_gst_invoice_invoice_number_unique" ON "gst_invoice" ("invoice_number") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_gst_invoice_deleted_at" ON "gst_invoice" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "gst_invoice" cascade;`);
  }

}
