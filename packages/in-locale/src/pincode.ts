/**
 * Pincode helpers.
 *
 * Validation only — serviceability, estimated delivery date, and COD
 * availability come from the courier aggregator and live in apps/api.
 */

/** Indian pincodes are six digits and never start with zero. */
const PINCODE_PATTERN = /^[1-9][0-9]{5}$/;

export function isValidPincode(value: string): boolean {
  return PINCODE_PATTERN.test(value.trim());
}

/** Strip everything but digits and cap at six, for controlled inputs. */
export function normalisePincodeInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}
