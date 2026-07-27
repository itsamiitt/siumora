/**
 * GST slabs and invoice math.
 *
 * Displayed prices are tax-inclusive (required by the Legal Metrology rules and
 * expected by Indian shoppers), so the tax is extracted *out of* the price
 * rather than added on top. Getting that direction wrong overcharges the
 * customer, so the extraction is unit-tested.
 */

/** GST 2.0 slabs relevant to the catalogue. */
export const GST_SLABS = [0, 5, 18, 40] as const;
export type GstSlab = (typeof GST_SLABS)[number];

export function isGstSlab(value: number): value is GstSlab {
  return (GST_SLABS as readonly number[]).includes(value);
}

export interface GstBreakup {
  /** Pre-tax value in paise. */
  readonly taxableValue: number;
  /** Central GST in paise. Zero on inter-state sales. */
  readonly cgst: number;
  /** State GST in paise. Zero on inter-state sales. */
  readonly sgst: number;
  /** Integrated GST in paise. Zero on intra-state sales. */
  readonly igst: number;
  /** Total tax in paise — always cgst + sgst + igst. */
  readonly totalTax: number;
  /** Tax-inclusive total in paise. Equals the price shown on the site. */
  readonly total: number;
}

/**
 * Split a tax-inclusive amount into its taxable value and GST components.
 *
 * Intra-state sales split the tax evenly into CGST and SGST; inter-state sales
 * put the whole amount into IGST. The odd paise from an uneven split goes to
 * CGST so the components always re-add to the exact total.
 */
export function extractGst(
  inclusivePaise: number,
  slab: GstSlab,
  { interState }: { interState: boolean },
): GstBreakup {
  if (slab === 0) {
    return {
      taxableValue: inclusivePaise,
      cgst: 0,
      sgst: 0,
      igst: 0,
      totalTax: 0,
      total: inclusivePaise,
    };
  }

  // taxable = inclusive / (1 + rate); tax is the remainder so nothing is lost
  // to rounding.
  const taxableValue = Math.round((inclusivePaise * 100) / (100 + slab));
  const totalTax = inclusivePaise - taxableValue;

  if (interState) {
    return {
      taxableValue,
      cgst: 0,
      sgst: 0,
      igst: totalTax,
      totalTax,
      total: inclusivePaise,
    };
  }

  const sgst = Math.floor(totalTax / 2);
  const cgst = totalTax - sgst;
  return { taxableValue, cgst, sgst, igst: 0, totalTax, total: inclusivePaise };
}

/** Maharashtra — the state the business is registered in (Mumbai). */
export const ORIGIN_STATE_CODE = "27";

/** A sale is inter-state when the delivery state differs from the origin. */
export function isInterState(destinationStateCode: string): boolean {
  return destinationStateCode !== ORIGIN_STATE_CODE;
}
