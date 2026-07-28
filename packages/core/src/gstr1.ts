import { ORIGIN_STATE_CODE, type GstSlab } from "./gst.ts";
import { hsnSummary, type HsnSummaryRow } from "./invoice.ts";
import type { CartLine } from "./cart.ts";

// Re-exported so callers that already reach for the return builder do not need
// a second import; the implementation lives on its own so the browser can take
// it without the GST engine.
export { gstinStateCode, isValidGstin } from "./gstin.ts";

/**
 * GSTR-1 return data.
 *
 * The monthly outward-supplies return every registered seller files. It is not
 * one list of invoices: the portal wants B2B supplies invoice by invoice,
 * because the buyer claims input credit against each one, and B2C supplies only
 * as totals per state and rate, because nobody is claiming credit on those.
 *
 * Built here as pure functions over orders so the figures can be checked against
 * the same GST engine that produced the invoices, rather than re-derived by a
 * spreadsheet that has drifted.
 *
 * This produces the *data*. Filing is the seller's accountant's job, and this
 * deliberately does not pretend to be a filing integration.
 */

/** Invoice-level detail, shared by the two tables that are filed invoice-wise. */
export interface InvoiceDetail {
  readonly invoiceNumber: string;
  /** ISO date. The portal wants DD-MM-YYYY; that is a formatting concern. */
  readonly invoiceDate: string;
  readonly invoiceValue: number;
  /** Two-digit state code of the ship-to address. */
  readonly placeOfSupply: string;
  readonly reverseCharge: boolean;
  readonly rows: readonly HsnSummaryRow[];
}

/** A supply to a registered buyer. The GSTIN is what makes it B2B. */
export interface B2bInvoice extends InvoiceDetail {
  readonly gstin: string;
}

/**
 * B2C small: totals per place of supply and rate.
 *
 * "Small" is the statutory term for inter-state supplies under ₹2.5 lakh and
 * all intra-state B2C. Every order this shop takes is well inside it, but the
 * threshold is applied rather than assumed — a single ₹3 lakh order would
 * otherwise be silently misfiled.
 */
export interface B2csRow {
  readonly placeOfSupply: string;
  readonly slab: GstSlab;
  readonly type: "intra" | "inter";
  readonly taxableValue: number;
  readonly cgst: number;
  readonly sgst: number;
  readonly igst: number;
}

/** Above this, an inter-state B2C supply is filed invoice-wise as B2CL. */
export const B2CL_THRESHOLD = 25000000;

/**
 * A large inter-state consumer supply, filed invoice-wise rather than summarised.
 *
 * `gstin` is explicitly null rather than absent: the portal has the column and
 * the distinction from B2B is exactly that there is nobody to credit.
 */
export interface B2clInvoice extends InvoiceDetail {
  readonly gstin: null;
}

export interface Gstr1Return {
  /** The tax period, as YYYY-MM. */
  readonly period: string;
  readonly b2b: readonly B2bInvoice[];
  readonly b2cl: readonly B2clInvoice[];
  readonly b2cs: readonly B2csRow[];
  readonly hsn: readonly HsnSummaryRow[];
  readonly totals: {
    readonly invoices: number;
    readonly taxableValue: number;
    readonly cgst: number;
    readonly sgst: number;
    readonly igst: number;
  };
}

export interface Gstr1Order {
  readonly invoiceNumber: string | null;
  readonly invoiceDate: Date;
  readonly total: number;
  readonly stateCode: string;
  readonly buyerGstin?: string | null;
  readonly lines: readonly CartLine[];
  /** Excluded from the return when true — a cancelled sale is not a supply. */
  readonly excluded?: boolean;
}

/**
 * Build the return for a period.
 *
 * Only invoiced orders appear. An order that never reached confirmation never
 * raised an invoice, and a return that lists supplies the seller cannot produce
 * an invoice for is a return that fails scrutiny.
 */
export function buildGstr1(
  orders: readonly Gstr1Order[],
  period: string,
): Gstr1Return {
  const b2b: B2bInvoice[] = [];
  const b2cl: B2clInvoice[] = [];
  const b2csGroups = new Map<string, B2csRow>();
  const allLines: CartLine[] = [];
  const interStateLines: CartLine[] = [];

  let taxableValue = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let invoices = 0;

  for (const order of orders) {
    if (order.excluded || !order.invoiceNumber) continue;
    if (monthOf(order.invoiceDate) !== period) continue;

    const interState = order.stateCode !== ORIGIN_STATE_CODE;
    const rows = hsnSummary(order.lines, { interState });

    invoices += 1;
    for (const row of rows) {
      taxableValue += row.taxableValue;
      cgst += row.cgst;
      sgst += row.sgst;
      igst += row.igst;
    }

    allLines.push(...order.lines);
    if (interState) interStateLines.push(...order.lines);

    const detail = {
      invoiceNumber: order.invoiceNumber,
      invoiceDate: isoDate(order.invoiceDate),
      invoiceValue: order.total,
      placeOfSupply: order.stateCode,
      // Reverse charge does not arise on retail jewellery. Stated rather than
      // omitted, because the portal has the column and a blank reads as unknown.
      reverseCharge: false,
      rows,
    };

    if (order.buyerGstin) {
      b2b.push({ ...detail, gstin: order.buyerGstin });
      continue;
    }

    // Inter-state and large: filed invoice-wise, not as a summary line.
    if (interState && order.total > B2CL_THRESHOLD) {
      b2cl.push({ ...detail, gstin: null });
      continue;
    }

    for (const row of rows) {
      const key = `${order.stateCode}:${row.slab}`;
      const existing = b2csGroups.get(key);
      if (existing) {
        b2csGroups.set(key, {
          ...existing,
          taxableValue: existing.taxableValue + row.taxableValue,
          cgst: existing.cgst + row.cgst,
          sgst: existing.sgst + row.sgst,
          igst: existing.igst + row.igst,
        });
      } else {
        b2csGroups.set(key, {
          placeOfSupply: order.stateCode,
          slab: row.slab,
          type: interState ? "inter" : "intra",
          taxableValue: row.taxableValue,
          cgst: row.cgst,
          sgst: row.sgst,
          igst: row.igst,
        });
      }
    }
  }

  return {
    period,
    b2b: b2b.sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber)),
    b2cl: b2cl.sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber)),
    b2cs: [...b2csGroups.values()].sort(
      (a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply) || a.slab - b.slab,
    ),
    // The HSN table covers every supply in the period regardless of how it was
    // filed above, which is what makes it the cross-check on the rest.
    hsn: combinedHsn(allLines, interStateLines),
    totals: { invoices, taxableValue, cgst, sgst, igst },
  };
}

/**
 * The period's HSN table.
 *
 * Intra- and inter-state lines are summarised separately and merged, because
 * the same HSN yields CGST+SGST on one and IGST on the other — running them
 * through one call would put the whole period on whichever flag was passed.
 */
function combinedHsn(
  all: readonly CartLine[],
  inter: readonly CartLine[],
): HsnSummaryRow[] {
  const interSet = new Set(inter);
  const intra = all.filter((line) => !interSet.has(line));

  const merged = new Map<string, HsnSummaryRow>();
  for (const row of [
    ...hsnSummary(intra, { interState: false }),
    ...hsnSummary(inter, { interState: true }),
  ]) {
    const key = `${row.hsn}:${row.slab}`;
    const existing = merged.get(key);
    merged.set(
      key,
      existing
        ? {
            ...existing,
            taxableValue: existing.taxableValue + row.taxableValue,
            cgst: existing.cgst + row.cgst,
            sgst: existing.sgst + row.sgst,
            igst: existing.igst + row.igst,
            total: existing.total + row.total,
          }
        : row,
    );
  }

  return [...merged.values()].sort(
    (a, b) => a.hsn.localeCompare(b.hsn) || a.slab - b.slab,
  );
}

/** YYYY-MM in IST — the tax period is an Indian calendar month. */
export function monthOf(date: Date): string {
  return isoDate(date).slice(0, 7);
}

function isoDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
