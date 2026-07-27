/**
 * Indian states and union territories with their GST state codes.
 *
 * The GST code is the first two digits of a GSTIN and decides whether a sale is
 * intra-state (CGST + SGST) or inter-state (IGST). The GST engine in apps/api
 * reads these codes, so they must match the official numbering exactly.
 */

export interface IndianState {
  /** Two-digit GST state code. */
  readonly code: string;
  readonly name: string;
  readonly type: "state" | "union-territory";
}

export const INDIAN_STATES: readonly IndianState[] = [
  { code: "01", name: "Jammu and Kashmir", type: "union-territory" },
  { code: "02", name: "Himachal Pradesh", type: "state" },
  { code: "03", name: "Punjab", type: "state" },
  { code: "04", name: "Chandigarh", type: "union-territory" },
  { code: "05", name: "Uttarakhand", type: "state" },
  { code: "06", name: "Haryana", type: "state" },
  { code: "07", name: "Delhi", type: "union-territory" },
  { code: "08", name: "Rajasthan", type: "state" },
  { code: "09", name: "Uttar Pradesh", type: "state" },
  { code: "10", name: "Bihar", type: "state" },
  { code: "11", name: "Sikkim", type: "state" },
  { code: "12", name: "Arunachal Pradesh", type: "state" },
  { code: "13", name: "Nagaland", type: "state" },
  { code: "14", name: "Manipur", type: "state" },
  { code: "15", name: "Mizoram", type: "state" },
  { code: "16", name: "Tripura", type: "state" },
  { code: "17", name: "Meghalaya", type: "state" },
  { code: "18", name: "Assam", type: "state" },
  { code: "19", name: "West Bengal", type: "state" },
  { code: "20", name: "Jharkhand", type: "state" },
  { code: "21", name: "Odisha", type: "state" },
  { code: "22", name: "Chhattisgarh", type: "state" },
  { code: "23", name: "Madhya Pradesh", type: "state" },
  { code: "24", name: "Gujarat", type: "state" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu", type: "union-territory" },
  { code: "27", name: "Maharashtra", type: "state" },
  { code: "29", name: "Karnataka", type: "state" },
  { code: "30", name: "Goa", type: "state" },
  { code: "31", name: "Lakshadweep", type: "union-territory" },
  { code: "32", name: "Kerala", type: "state" },
  { code: "33", name: "Tamil Nadu", type: "state" },
  { code: "34", name: "Puducherry", type: "union-territory" },
  { code: "35", name: "Andaman and Nicobar Islands", type: "union-territory" },
  { code: "36", name: "Telangana", type: "state" },
  { code: "37", name: "Andhra Pradesh", type: "state" },
  { code: "38", name: "Ladakh", type: "union-territory" },
] as const;

const BY_CODE = new Map(INDIAN_STATES.map((s) => [s.code, s]));

export function stateByCode(code: string): IndianState | undefined {
  return BY_CODE.get(code);
}

/** Extract the GST state code from a GSTIN. Returns undefined if malformed. */
export function stateCodeFromGstin(gstin: string): string | undefined {
  const code = gstin.trim().slice(0, 2);
  return BY_CODE.has(code) ? code : undefined;
}
