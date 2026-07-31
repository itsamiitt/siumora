import { model } from "@medusajs/framework/utils";

/**
 * The statutory GST invoice for a Medusa order (design doc M2: "gst module
 * with its own tables ... carrying the FY-unique partial index and a
 * same-table allocation lock").
 *
 * One row per invoiced order:
 * - `order_id` — the Medusa order id. A text reference, deliberately not a
 *   foreign key, per the design doc's module-isolation rule: module tables do
 *   not reach into Medusa-owned tables. Unique — one invoice per order, the
 *   allocation insert's ON CONFLICT arbiter (idempotent issue).
 * - `financial_year` — Indian FY label, e.g. "2026-27" (core's
 *   financialYear). The series restarts at 1 each April.
 * - `sequence` — position in the FY's series. Drawn as MAX+1 inside the
 *   allocation INSERT itself under a same-table lock (see allocate.ts): a
 *   statutory series must be gapless, so a Postgres sequence — which burns a
 *   value on rollback — is deliberately NOT used here.
 * - `invoice_number` — SIU/<fy>/<seq, 6 digits>, core invoiceNumber()'s
 *   format, built in SQL in the same statement as the draw.
 * - `buyer_gstin` — present makes this a B2B supply (input-credit claimable);
 *   null is the retail consumer case.
 * - `interstate` — delivery state differs from the seller's registration
 *   (core ORIGIN_STATE_CODE). Decides IGST vs CGST+SGST, snapshotted because
 *   recomputing it later against a moved warehouse would restate a filed
 *   return.
 * - `rows` — the HSN-wise summary (core hsnSummary shape), snapshotted at
 *   issue. The GSTR-1 return is filed from exactly these rows.
 * - `totals` — core summariseInvoice over `rows`, asserted to re-add before
 *   the write (invoice.ts assertInvoiceReconciles).
 *
 * created_at/updated_at/deleted_at come with model.define.
 */
export const GstInvoice = model
  .define("gst_invoice", {
    id: model.id({ prefix: "gsinv" }).primaryKey(),
    order_id: model.text().unique(),
    financial_year: model.text(),
    sequence: model.number(),
    invoice_number: model.text().unique(),
    buyer_gstin: model.text().nullable(),
    interstate: model.boolean(),
    rows: model.json(),
    totals: model.json(),
  })
  .indexes([
    {
      name: "IDX_gst_invoice_series_unique",
      on: ["financial_year", "sequence"],
      unique: true,
      where: "deleted_at IS NULL",
    },
  ]);
