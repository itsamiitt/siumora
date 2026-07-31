/**
 * Pure invoice logic — strippable by node --test, no Medusa imports (same
 * convention as siumora-order/identity.ts). Everything the routes decide
 * that is worth a unit test lives here; the routes stay thin I/O.
 *
 * Core itself IS imported (value imports via the require-condition dist,
 * the phone-auth convention): the whole point of the gst module is that the
 * stored rows/totals come from the same engine that computed the Fastify
 * invoices — hsnSummary and summariseInvoice, not a re-implementation.
 */

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { hsnSummary, isGstSlab, summariseInvoice, type CartLine, type HsnSummaryRow, type InvoiceTotals } from "@siumora/core";

// The .ts extension is deliberate: this file is imported by invoice.test.ts
// under node --test's ESM loader, which resolves relative paths literally
// (same convention as serviceability/lookup.ts). Medusa's require hook
// resolves it identically at runtime.
import { linePaise, wireNumber, type OrderLineWire } from "../siumora-order/identity.ts";

/**
 * The invoice-number format, mirrored from @siumora/core's invoiceNumber().
 *
 * Mirrored rather than only imported for one reason: the authoritative
 * formatting happens in SQL (allocate.ts builds the number inside the INSERT
 * so the sequence draw and the row are one atomic statement), and this JS
 * mirror exists to let the unit tests prove the SQL expression and core's
 * invoiceNumber() agree. invoice.test.ts pins both against @siumora/core.
 */
export function formatInvoiceNumber(sequence: number, financialYear: string): string {
  return `SIU/${financialYear}/${String(sequence).padStart(6, "0")}`;
}

/**
 * The SQL twin of formatInvoiceNumber, used inside the allocation INSERT.
 *
 * `next.seq` is the FY-scoped MAX+1 the INSERT's FROM clause draws; the one
 * binding is the financial-year label. Note what is NOT here: nextval(). A
 * Postgres sequence burns a value on rollback — tolerable for order numbers,
 * illegal for a gapless statutory series.
 */
export const INVOICE_NUMBER_SQL = "'SIU/' || ?::text || '/' || lpad(next.seq::text, 6, '0')";

/** The row shape allocate.ts returns — mirrored here so envelopes stay pure. */
export interface GstInvoiceRow {
  id: string;
  order_id: string;
  financial_year: string;
  sequence: number;
  invoice_number: string;
  buyer_gstin: string | null;
  interstate: boolean;
  /** jsonb — core HsnSummaryRow[], exactly as computed at issue. */
  rows: HsnSummaryRow[];
  /** jsonb — core InvoiceTotals, asserted to re-add before the write. */
  totals: InvoiceTotals;
  created_at: string | Date;
}

/**
 * The invoice card the order read serves — the same { rows, totals } shape
 * the Fastify /orders/:number response carries, straight off the stored row
 * so the customer sees the invoice that was actually issued, not a
 * recomputation that could drift from it.
 */
export function invoiceCard(
  row: GstInvoiceRow,
): { rows: HsnSummaryRow[]; totals: InvoiceTotals } {
  return { rows: row.rows, totals: row.totals };
}

/** The slice of a Medusa order line the invoice mapping reads. Structurally
 * a superset of siumora-order's OrderLineWire, so linePaise takes it as-is. */
export interface InvoiceLineWire extends OrderLineWire {
  variant_id?: string | null;
  variant_sku?: string | null;
  variant_title?: string | null;
  product_title?: string | null;
  product_handle?: string | null;
  title?: string | null;
  thumbnail?: string | null;
  variant?: {
    id?: string;
    metadata?: { mrp_paise?: unknown; price_paise?: unknown } | null;
    product?: { metadata?: Record<string, unknown> | null } | null;
  } | null;
}

/**
 * Medusa order lines → the domain CartLine[] the invoice engine takes.
 *
 * STRICT where the order-read card is lenient: an invoice line without a
 * valid GST slab or an HSN code cannot go on a statutory document, so the
 * issue is refused (thrown) rather than issued with a hole where the tax
 * treatment belongs. Money reads the same lossless channel as everywhere
 * else (variant metadata paise first — linePaise).
 */
export function toInvoiceLines(items: ReadonlyArray<InvoiceLineWire>): CartLine[] {
  if (items.length === 0) {
    throw new Error("invoice refused: the order has no lines");
  }
  return items.map((item) => {
    const paise = linePaise(item);
    const sku = item.variant_sku ?? "";
    const productMetadata = item.variant?.product?.metadata ?? {};
    const slab = productMetadata.gst_slab;
    if (typeof slab !== "number" || !isGstSlab(slab)) {
      throw new Error(
        `invoice refused: line ${sku || "(no sku)"} has no valid gst_slab (${JSON.stringify(slab)})`,
      );
    }
    const hsn = productMetadata.hsn;
    if (typeof hsn !== "string" || hsn.trim().length === 0) {
      throw new Error(`invoice refused: line ${sku || "(no sku)"} has no HSN code`);
    }
    return {
      variantId: item.variant_id ?? item.variant?.id ?? "",
      sku,
      productHandle: item.product_handle ?? "",
      title: item.product_title ?? item.title ?? "",
      variantTitle: item.variant_title ?? "",
      imageUrl: item.thumbnail ?? "",
      mrp: paise.mrp,
      unitPrice: paise.unitPrice,
      quantity: wireNumber(item.quantity, "quantity"),
      gstSlab: slab as CartLine["gstSlab"],
      hsn,
      piercedJewellery: productMetadata.pierced_jewellery === true,
    };
  });
}

/**
 * The app-assertion that replaced the Fastify schema's cross-table CHECKs
 * (the disposition in the module migration): before anything is written,
 * the rows must re-add to the totals, the totals must re-add to themselves
 * (taxable + cgst + sgst + igst == total, totalTax == the three heads), the
 * heads must respect the interstate split, and the invoice total must equal
 * the order's goods value computed INDEPENDENTLY off the lines. Any drift
 * refuses the write — a wrong statutory row is worse than a late one.
 */
export function assertInvoiceReconciles(
  rows: readonly HsnSummaryRow[],
  totals: InvoiceTotals,
  expected: { goodsTotal: number; interState: boolean },
): void {
  const refuse = (reason: string): never => {
    throw new Error(`invoice refused: ${reason}`);
  };

  if (rows.length === 0) refuse("no HSN rows");

  const sum = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
  for (const row of rows) {
    if (row.taxableValue + row.cgst + row.sgst + row.igst !== row.total) {
      refuse(`HSN ${row.hsn}@${row.slab}% does not re-add to its total`);
    }
    if (expected.interState && (row.cgst !== 0 || row.sgst !== 0)) {
      refuse(`HSN ${row.hsn}@${row.slab}% carries CGST/SGST on an inter-state supply`);
    }
    if (!expected.interState && row.igst !== 0) {
      refuse(`HSN ${row.hsn}@${row.slab}% carries IGST on an intra-state supply`);
    }
    sum.taxableValue += row.taxableValue;
    sum.cgst += row.cgst;
    sum.sgst += row.sgst;
    sum.igst += row.igst;
    sum.total += row.total;
  }

  if (
    sum.taxableValue !== totals.taxableValue ||
    sum.cgst !== totals.cgst ||
    sum.sgst !== totals.sgst ||
    sum.igst !== totals.igst ||
    sum.total !== totals.total
  ) {
    refuse("the HSN rows do not sum to the invoice totals");
  }
  if (totals.cgst + totals.sgst + totals.igst !== totals.totalTax) {
    refuse("the tax heads do not sum to totalTax");
  }
  if (totals.taxableValue + totals.totalTax !== totals.total) {
    refuse("taxable value plus tax does not re-add to the total");
  }
  if (totals.total !== expected.goodsTotal) {
    refuse(
      `invoice total ${totals.total} disagrees with the order's goods value ${expected.goodsTotal}`,
    );
  }
}

/**
 * Compute the statutory card for an order's lines: core's hsnSummary +
 * summariseInvoice, then the reconciliation assertion against the goods
 * value summed independently off the lines. Throws (refusing the issue)
 * rather than returning a card that does not re-add.
 */
export function computeInvoice(
  lines: readonly CartLine[],
  options: { interState: boolean },
): { rows: HsnSummaryRow[]; totals: InvoiceTotals } {
  const rows: HsnSummaryRow[] = hsnSummary(lines, options);
  const totals: InvoiceTotals = summariseInvoice(rows);
  const goodsTotal = lines.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0,
  );
  assertInvoiceReconciles(rows, totals, {
    goodsTotal,
    interState: options.interState,
  });
  return { rows, totals };
}
