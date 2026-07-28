/**
 * GSTIN validation.
 *
 * Its own module, with no imports at all, so the checkout form can reach it
 * without pulling the GST engine — and Zod behind it — into the browser bundle.
 */

/**
 * A GSTIN is 15 characters: 2 state code, 10 PAN, 1 entity, 1 'Z', 1 checksum.
 *
 * Validated structurally *and* by check digit. A typo'd GSTIN on an invoice
 * denies the buyer their input credit and lands in the seller's mismatch
 * report, so catching it where somebody can still fix it is worth the
 * arithmetic — and the structural test alone misses exactly the single-character
 * slip that a person typing fifteen characters actually makes.
 */
export function isValidGstin(value: string): boolean {
  const gstin = value.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return false;
  return gstin[14] === gstinChecksum(gstin.slice(0, 14));
}

const CODES = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The portal's own check-digit algorithm: alternating weights, base 36. */
function gstinChecksum(first14: string): string {
  let sum = 0;
  for (let i = 0; i < first14.length; i += 1) {
    const value = CODES.indexOf(first14[i] as string);
    const weighted = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(weighted / 36) + (weighted % 36);
  }
  return CODES[(36 - (sum % 36)) % 36] as string;
}

/** The state a GSTIN belongs to, which must match the place of supply. */
export function gstinStateCode(gstin: string): string {
  return gstin.slice(0, 2);
}
