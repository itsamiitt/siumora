import type { CartLine } from "./cart.ts";
import { extractGst, type GstSlab } from "./gst.ts";

/**
 * GST invoice numbering and the HSN-wise summary.
 *
 * Two rules from the GST regime drive everything here:
 *
 * 1. Invoice numbers are **sequential within a financial year**, and the Indian
 *    financial year runs April to March — not January to December. A series
 *    that resets on 1 January is wrong, and it is wrong in a way that only
 *    surfaces at the first annual return.
 * 2. The return is filed **HSN-wise**, so the invoice has to group by HSN and
 *    slab rather than just totalling the tax.
 */

/**
 * Indian financial year label for a date, e.g. `2026-27`.
 *
 * April starts a new year; January to March still belong to the year that
 * began the previous April.
 */
export function financialYear(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0 = January
  const startYear = month >= 3 ? year : year - 1; // 3 = April
  const endShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endShort}`;
}

/**
 * Build an invoice number.
 *
 * Shape: `SIU/2026-27/000123`. The financial year is part of the number so the
 * sequence can restart at 1 each year while every number stays unique and
 * self-describing.
 */
export function invoiceNumber(sequence: number, date: Date, prefix = "SIU"): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError("invoice sequence must be a positive integer");
  }
  return `${prefix}/${financialYear(date)}/${String(sequence).padStart(6, "0")}`;
}

/** Customer-facing order number. Shorter and friendlier than the invoice. */
export function orderNumber(sequence: number, prefix = "SIU"): string {
  return `${prefix}-${String(sequence).padStart(5, "0")}`;
}

export interface HsnSummaryRow {
  readonly hsn: string;
  readonly slab: GstSlab;
  /** Pre-tax value in paise for this HSN and slab. */
  readonly taxableValue: number;
  readonly cgst: number;
  readonly sgst: number;
  readonly igst: number;
  readonly total: number;
}

/**
 * HSN-wise tax summary for the invoice and the GSTR-1 export.
 *
 * Grouped by HSN *and* slab: the same HSN can legitimately fall in different
 * slabs (the garment threshold is the standard example), and collapsing them
 * would misreport both.
 */
export function hsnSummary(
  lines: readonly CartLine[],
  options: { interState: boolean },
): HsnSummaryRow[] {
  const groups = new Map<string, { hsn: string; slab: GstSlab; amount: number }>();

  for (const line of lines) {
    const key = `${line.hsn}:${line.gstSlab}`;
    const existing = groups.get(key);
    const amount = line.unitPrice * line.quantity;

    if (existing) existing.amount += amount;
    else groups.set(key, { hsn: line.hsn, slab: line.gstSlab, amount });
  }

  return [...groups.values()]
    .map((group) => {
      const gst = extractGst(group.amount, group.slab, options);
      return {
        hsn: group.hsn,
        slab: group.slab,
        taxableValue: gst.taxableValue,
        cgst: gst.cgst,
        sgst: gst.sgst,
        igst: gst.igst,
        total: group.amount,
      };
    })
    .sort((a, b) => a.hsn.localeCompare(b.hsn) || a.slab - b.slab);
}

export interface InvoiceTotals {
  readonly taxableValue: number;
  readonly cgst: number;
  readonly sgst: number;
  readonly igst: number;
  readonly totalTax: number;
  readonly total: number;
}

/** Sum an HSN summary. The components always re-add to the invoice total. */
export function summariseInvoice(rows: readonly HsnSummaryRow[]): InvoiceTotals {
  const totals = rows.reduce(
    (acc, row) => ({
      taxableValue: acc.taxableValue + row.taxableValue,
      cgst: acc.cgst + row.cgst,
      sgst: acc.sgst + row.sgst,
      igst: acc.igst + row.igst,
      total: acc.total + row.total,
    }),
    { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, total: 0 },
  );

  return { ...totals, totalTax: totals.cgst + totals.sgst + totals.igst };
}
