/**
 * Rupee formatting for the Indian market.
 *
 * Money is stored in paise (integer minor units) everywhere in the codebase so
 * that arithmetic never touches floating point. Only format at the edge.
 */

export const LOCALE = "en-IN" as const;
export const CURRENCY = "INR" as const;

/** Paise per rupee. */
export const MINOR_UNITS = 100;

const rupeeFormatter = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const rupeeFormatterWithPaise = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const plainFormatter = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export interface FormatOptions {
  /**
   * Show paise. Default false — Indian retail prices are whole rupees, and a
   * trailing `.00` reads as noise on a product card.
   */
  showPaise?: boolean;
}

/**
 * Format paise as a rupee string using the Indian digit grouping
 * (2,2,3 — so 10000000 paise renders as ₹1,00,000).
 */
export function formatPaise(paise: number, options: FormatOptions = {}): string {
  const rupees = paise / MINOR_UNITS;
  const formatter = options.showPaise ? rupeeFormatterWithPaise : rupeeFormatter;
  return formatter.format(rupees);
}

/** Format a whole-rupee amount. Convenience wrapper over {@link formatPaise}. */
export function formatRupees(rupees: number, options: FormatOptions = {}): string {
  return formatPaise(Math.round(rupees * MINOR_UNITS), options);
}

/** Format a bare number with Indian grouping and no currency symbol. */
export function formatIndianNumber(value: number): string {
  return plainFormatter.format(value);
}

/**
 * Discount percentage off MRP, floored to a whole number.
 *
 * Floored rather than rounded because a "16% off" chip above an actual 16.7%
 * discount is a claim we can always honour; rounding up overstates it.
 */
export function discountPercent(mrpPaise: number, sellingPaise: number): number {
  if (mrpPaise <= 0 || sellingPaise >= mrpPaise) return 0;
  return Math.floor(((mrpPaise - sellingPaise) / mrpPaise) * 100);
}

/**
 * Per-month EMI for a tenure in months, rounded up to the rupee.
 *
 * No-cost EMI only — the interest-bearing case depends on the issuing bank's
 * rate and must come from the payment gateway, not from us.
 */
export function noCostEmiPerMonth(paise: number, months: number): number {
  if (months <= 0) return paise;
  return Math.ceil(paise / months);
}
