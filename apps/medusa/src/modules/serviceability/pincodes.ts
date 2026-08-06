/**
 * The canonical pincode serviceability rows, ported from
 * packages/db/src/seed.ts (`PINCODES` — inline there, not exported). That
 * file stays the source of truth for the dual-run window; this module is the
 * Medusa-shaped copy of the same five rows. If the numbers here ever drift
 * from packages/db/src/seed.ts, that is a bug in this file.
 *
 * The source rows do not carry `serviceable` — they rely on the table
 * default (true). The in-module seed (lookup.ts seedServiceability) applies
 * the same default explicitly, so the rows here can stay verbatim.
 */

export interface SeedPincode {
  pincode: string;
  city: string;
  /** Two-digit GST state code — the place-of-supply signal. */
  stateCode: string;
  codAvailable: boolean;
  estimatedDays: string;
  /** Historical RTO rate in basis points — integer, so no float drift. */
  rtoRateBps: number;
}

/** Metro pincodes get the faster window and COD; the rest are standard. */
export const PINCODES: SeedPincode[] = [
  { pincode: "400001", city: "Mumbai", stateCode: "27", codAvailable: true, estimatedDays: "2-3", rtoRateBps: 400 },
  { pincode: "110001", city: "Delhi", stateCode: "07", codAvailable: true, estimatedDays: "2-3", rtoRateBps: 2600 },
  { pincode: "560001", city: "Bengaluru", stateCode: "29", codAvailable: true, estimatedDays: "2-3", rtoRateBps: 700 },
  { pincode: "700001", city: "Kolkata", stateCode: "19", codAvailable: true, estimatedDays: "3-4", rtoRateBps: 1500 },
  { pincode: "781001", city: "Guwahati", stateCode: "18", codAvailable: false, estimatedDays: "5-7", rtoRateBps: 2200 },
];
