/**
 * The daily GST reconciliation — the pure half (TODO(gst-recon-daily), plan
 * 18 L1.1). The module migration's disposition traded the Fastify schema's
 * cross-table CHECKs for two things: the write-time assertion in invoice.ts,
 * and "a daily reconciliation that proves books against Medusa's order
 * totals and alarms". This is the second one.
 *
 * Proving, not trusting: every stored invoice is recomputed from its order's
 * persisted lines through the same engine that issued it (computeInvoice),
 * and the two must agree to the paisa. The stored rows must still re-add on
 * their own (assertInvoiceReconciles). The place of supply must still say
 * what the snapshot says. Every order must have exactly one invoice, and
 * every invoice an order. Each financial year's series must run 1..N with no
 * hole and no repeat, each number spelled exactly as formatInvoiceNumber
 * spells it.
 *
 * It reports; it does not repair. A missing invoice is healed by the
 * order.placed subscriber or a person — the recon issuing one itself would
 * hide the very crash it exists to surface.
 *
 * No Medusa imports, so node --test runs it directly (invoice.ts convention).
 */

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { isInterState, type CartLine, type InvoiceTotals } from "@siumora/core";

import {
  assertInvoiceReconciles,
  computeInvoice,
  formatInvoiceNumber,
  toInvoiceLines,
  type GstInvoiceRow,
  type InvoiceLineWire,
} from "./invoice.ts";

export type ReconFindingKind =
  | "missing_invoice"
  | "orphan_invoice"
  | "lines_unreadable"
  | "totals_drift"
  | "rows_inconsistent"
  | "interstate_mismatch"
  | "series_gap"
  | "series_duplicate"
  | "number_malformed";

export interface ReconFinding {
  kind: ReconFindingKind;
  orderId?: string;
  invoiceNumber?: string;
  detail: string;
}

/** The slice of a Medusa order the recon reads — what issue.ts reads. */
export interface ReconOrderWire {
  id: string;
  shipping_address?: { province?: string | null } | null;
  items?: Array<InvoiceLineWire | null> | null;
}

/** The slice of the series the gap/duplicate check needs. */
export interface SeriesEntry {
  financial_year: string;
  sequence: number;
  invoice_number: string;
}

const TOTAL_FIELDS: ReadonlyArray<keyof InvoiceTotals> = [
  "taxableValue",
  "cgst",
  "sgst",
  "igst",
  "totalTax",
  "total",
];

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Orders against their invoices. `orders` must include the order behind
 * every invoice passed in (the job fetches both directions), otherwise that
 * invoice reads as an orphan.
 */
export function reconcileInvoices(
  orders: ReadonlyArray<ReconOrderWire>,
  invoices: ReadonlyArray<GstInvoiceRow>,
): ReconFinding[] {
  const findings: ReconFinding[] = [];
  const invoiceByOrder = new Map<string, GstInvoiceRow>();
  for (const invoice of invoices) invoiceByOrder.set(invoice.order_id, invoice);
  const orderIds = new Set(orders.map((order) => order.id));

  for (const invoice of invoices) {
    if (!orderIds.has(invoice.order_id)) {
      findings.push({
        kind: "orphan_invoice",
        orderId: invoice.order_id,
        invoiceNumber: invoice.invoice_number,
        detail: "invoice names an order that does not exist",
      });
    }
  }

  for (const order of orders) {
    const invoice = invoiceByOrder.get(order.id);
    if (!invoice) {
      findings.push({ kind: "missing_invoice", orderId: order.id, detail: "placed order has no invoice" });
      continue;
    }
    const base = { orderId: order.id, invoiceNumber: invoice.invoice_number };

    const province = order.shipping_address?.province;
    if (typeof province === "string" && province.trim().length > 0) {
      const interState = isInterState(province) as boolean;
      if (interState !== invoice.interstate) {
        findings.push({
          ...base,
          kind: "interstate_mismatch",
          detail: `invoice says ${invoice.interstate ? "inter" : "intra"}-state, the delivery state ${province} says ${
            interState ? "inter" : "intra"
          }-state`,
        });
      }
    }

    let lines: CartLine[];
    try {
      lines = toInvoiceLines((order.items ?? []).filter((item): item is InvoiceLineWire => Boolean(item)));
    } catch (error) {
      findings.push({ ...base, kind: "lines_unreadable", detail: reason(error) });
      continue;
    }

    let fresh: { totals: InvoiceTotals };
    try {
      fresh = computeInvoice(lines, { interState: invoice.interstate });
    } catch (error) {
      findings.push({ ...base, kind: "totals_drift", detail: `the order no longer computes: ${reason(error)}` });
      continue;
    }

    const drifted = TOTAL_FIELDS.filter((field) => fresh.totals[field] !== invoice.totals?.[field]);
    if (drifted.length > 0) {
      findings.push({
        ...base,
        kind: "totals_drift",
        detail: drifted
          .map((field) => `${field}: invoice ${invoice.totals?.[field]} vs order ${fresh.totals[field]}`)
          .join("; "),
      });
    }

    try {
      assertInvoiceReconciles(invoice.rows ?? [], invoice.totals, {
        goodsTotal: fresh.totals.total,
        interState: invoice.interstate,
      });
    } catch (error) {
      // Totals drift is already named above; this catches stored rows that
      // no longer re-add even where the headline total still matches.
      if (drifted.length === 0) {
        findings.push({ ...base, kind: "rows_inconsistent", detail: reason(error) });
      }
    }
  }

  return findings;
}

/**
 * Each financial year's series must be 1..N: no repeat (the partial unique
 * index should make that impossible — this proves the index is still there)
 * and no hole (the MAX+1-under-lock draw should make that impossible — a
 * hole means a row was deleted). Pass every live row of the years checked.
 */
export function checkSeries(entries: ReadonlyArray<SeriesEntry>): ReconFinding[] {
  const findings: ReconFinding[] = [];
  const byYear = new Map<string, SeriesEntry[]>();
  for (const entry of entries) {
    const list = byYear.get(entry.financial_year) ?? [];
    list.push(entry);
    byYear.set(entry.financial_year, list);

    const expected = formatInvoiceNumber(entry.sequence, entry.financial_year);
    if (entry.invoice_number !== expected) {
      findings.push({
        kind: "number_malformed",
        invoiceNumber: entry.invoice_number,
        detail: `sequence ${entry.sequence} in ${entry.financial_year} should read ${expected}`,
      });
    }
  }

  for (const [year, list] of [...byYear.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const counts = new Map<number, number>();
    for (const entry of list) counts.set(entry.sequence, (counts.get(entry.sequence) ?? 0) + 1);

    for (const [sequence, count] of [...counts.entries()].sort(([a], [b]) => a - b)) {
      if (count > 1) {
        findings.push({
          kind: "series_duplicate",
          invoiceNumber: formatInvoiceNumber(sequence, year),
          detail: `${year} sequence ${sequence} is used ${count} times`,
        });
      }
    }

    const max = Math.max(...counts.keys());
    const missing: number[] = [];
    for (let sequence = 1; sequence <= max; sequence += 1) {
      if (!counts.has(sequence)) missing.push(sequence);
    }
    if (missing.length > 0) {
      const shown = missing.slice(0, 20).join(", ");
      findings.push({
        kind: "series_gap",
        detail: `${year} is missing sequence ${shown}${missing.length > 20 ? ` (+${missing.length - 20} more)` : ""}`,
      });
    }
  }

  return findings;
}

/** One line per finding, for the log and the alert. */
export function describeFinding(finding: ReconFinding): string {
  const where = [finding.invoiceNumber, finding.orderId].filter(Boolean).join(" / ");
  return `${finding.kind}${where ? ` [${where}]` : ""}: ${finding.detail}`;
}
