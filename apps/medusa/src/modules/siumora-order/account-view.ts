/**
 * Pure shaping for the signed-in account's order surfaces (auth plan
 * phase 2) — no Medusa imports, so node --test can strip-type it.
 */

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { hsnSummary, isGstSlab, isInterState, summariseInvoice } from "@siumora/core";

export interface TaxLine {
  readonly unitPrice: number;
  readonly mrp: number;
  readonly quantity: number;
  readonly gstSlab: number | null;
  readonly hsn: string;
}

export interface TaxFields {
  readonly taxableValue: number;
  readonly cgst: number;
  readonly sgst: number;
  readonly igst: number;
  readonly interState: boolean;
}

/**
 * The tax split the account's order list shows, in the Fastify order row's
 * flat field names (the storefront's toDomain reads them). The stored
 * statutory invoice wins when there is one; otherwise the same core engine
 * computes it from the lines — exactly the SDK's getOrder fallback. A line
 * without a valid slab yields zeros rather than a guess.
 */
export function taxFields(
  lines: readonly TaxLine[],
  invoiceTotals: { taxableValue: number; cgst: number; sgst: number; igst: number } | null,
  province: string,
): TaxFields {
  const interState = isInterState(province);
  if (invoiceTotals) {
    return {
      taxableValue: invoiceTotals.taxableValue,
      cgst: invoiceTotals.cgst,
      sgst: invoiceTotals.sgst,
      igst: invoiceTotals.igst,
      interState,
    };
  }
  if (lines.length === 0 || !lines.every((line) => isGstSlab(line.gstSlab ?? -1))) {
    return { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, interState };
  }
  const totals = summariseInvoice(hsnSummary(lines as never, { interState }));
  return {
    taxableValue: totals.taxableValue,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    interState,
  };
}

export interface ClaimableOrder {
  readonly number: string;
  readonly placedAt: string;
  readonly itemCount: number;
  readonly total: number;
  /** Enough to recognise a delivery ("Pune"), not enough to locate one. */
  readonly city: string | null;
}

/**
 * "Is this your order?" — what a phone's new owner is shown about a guest
 * order before claiming it. Deliberately thin: number, date, how many
 * pieces, what it cost, the city. No name, no street, no items: if the
 * order is not theirs, they have learned nothing worth having.
 */
export function claimableView(input: {
  orderNumber: string;
  placedAt: string | Date;
  lines: ReadonlyArray<{ quantity: number; unitPrice: number }>;
  shipping: number;
  city: unknown;
}): ClaimableOrder {
  return {
    number: input.orderNumber,
    placedAt: new Date(input.placedAt).toISOString(),
    itemCount: input.lines.reduce((sum, line) => sum + line.quantity, 0),
    total: input.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0) + input.shipping,
    city: typeof input.city === "string" && input.city.trim() ? input.city.trim() : null,
  };
}

/** The numbers a claim request may take: well-formed, deduplicated, few. */
export function claimRequest(body: unknown): string[] | undefined {
  const numbers = (body as { numbers?: unknown } | null)?.numbers;
  if (!Array.isArray(numbers) || numbers.length === 0 || numbers.length > 50) return undefined;
  if (!numbers.every((value) => typeof value === "string" && /^SIU-\d{3,10}$/.test(value))) {
    return undefined;
  }
  return [...new Set(numbers as string[])];
}
