import { extractGst, type GstBreakup, type GstSlab } from "./gst.ts";

/**
 * Cart totals and the GST breakup that goes on the invoice.
 *
 * Every amount is paise, tax-inclusive — the figure shown on the site is the
 * figure charged. Tax is extracted at the end rather than accumulated per line
 * so the invoice total always equals the sum of the line prices exactly.
 */

export interface CartLine {
  readonly variantId: string;
  /**
   * The SKU. Carried on the line because it is the id the Merchant Center and
   * Meta catalog feeds key on — analytics must send this, not the variant id.
   */
  readonly sku: string;
  readonly productHandle: string;
  readonly title: string;
  /** Variant name, e.g. "Gold". */
  readonly variantTitle: string;
  readonly imageUrl: string;
  /** Unit MRP in paise, tax-inclusive. */
  readonly mrp: number;
  /** Unit selling price in paise, tax-inclusive. */
  readonly unitPrice: number;
  readonly quantity: number;
  readonly gstSlab: GstSlab;
  readonly hsn: string;
}

export interface CartTotals {
  /** Sum of line MRPs — the "you saved" comparison base. */
  readonly mrpTotal: number;
  /** Sum of line selling prices, tax-inclusive. */
  readonly subtotal: number;
  /** mrpTotal − subtotal. */
  readonly savings: number;
  readonly shipping: number;
  /** COD handling fee, zero on prepaid. */
  readonly codFee: number;
  /** Everything the customer pays, tax-inclusive. */
  readonly total: number;
  /** Tax contained within `total`, never added to it. */
  readonly gst: GstBreakup;
  readonly itemCount: number;
}

export interface TotalsOptions {
  readonly interState: boolean;
  /** Shipping charge in paise, tax-inclusive. */
  readonly shipping?: number;
  /** COD fee in paise, tax-inclusive. */
  readonly codFee?: number;
}

export function lineTotal(line: CartLine): number {
  return line.unitPrice * line.quantity;
}

/**
 * The slab that governs a composite supply.
 *
 * Under the composite-supply rule, shipping is taxed at the rate of the
 * principal goods rather than at its own rate. The principal supply is the
 * highest-value line, so its slab decides the shipping tax.
 */
export function principalSlab(lines: readonly CartLine[]): GstSlab {
  if (lines.length === 0) return 0;

  let principal = lines[0]!;
  for (const line of lines) {
    if (lineTotal(line) > lineTotal(principal)) principal = line;
  }
  return principal.gstSlab;
}

/**
 * Cart totals with a single GST breakup.
 *
 * Lines are grouped by slab, tax is extracted per slab, and the components are
 * summed. Grouping matters: extracting once against a blended rate would put
 * the wrong figures on a GSTR-1 return.
 */
export function calculateTotals(
  lines: readonly CartLine[],
  options: TotalsOptions,
): CartTotals {
  const { interState, shipping = 0, codFee = 0 } = options;

  const mrpTotal = lines.reduce((sum, l) => sum + l.mrp * l.quantity, 0);
  const subtotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);
  const total = subtotal + shipping + codFee;

  // Bucket taxable amounts by slab. Shipping and the COD fee ride the
  // principal slab as part of the composite supply.
  const bySlab = new Map<GstSlab, number>();
  const add = (slab: GstSlab, amount: number) => {
    if (amount > 0) bySlab.set(slab, (bySlab.get(slab) ?? 0) + amount);
  };

  for (const line of lines) add(line.gstSlab, lineTotal(line));
  add(principalSlab(lines), shipping + codFee);

  let taxableValue = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  for (const [slab, amount] of bySlab) {
    const part = extractGst(amount, slab, { interState });
    taxableValue += part.taxableValue;
    cgst += part.cgst;
    sgst += part.sgst;
    igst += part.igst;
  }

  const totalTax = cgst + sgst + igst;

  return {
    mrpTotal,
    subtotal,
    savings: mrpTotal - subtotal,
    shipping,
    codFee,
    total,
    gst: { taxableValue, cgst, sgst, igst, totalTax, total },
    itemCount,
  };
}

/** Free shipping at ₹999 and above; ₹79 below it. */
export const FREE_SHIPPING_THRESHOLD = 99900;
export const STANDARD_SHIPPING = 7900;

export function shippingFor(subtotal: number): number {
  return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING;
}

/** Paise still needed to reach free shipping. Zero once it is reached. */
export function amountToFreeShipping(subtotal: number): number {
  return Math.max(0, FREE_SHIPPING_THRESHOLD - subtotal);
}
