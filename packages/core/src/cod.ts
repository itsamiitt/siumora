/**
 * Cash-on-delivery eligibility.
 *
 * COD is the default expectation for a large share of Indian shoppers and the
 * single biggest lever on unit economics, because a returned-to-origin parcel
 * costs freight both ways and returns nothing. Eligibility is therefore gated
 * on pincode serviceability, order value, and the RTO risk score together —
 * any one of them can withhold it.
 */

export type RtoRisk = "low" | "medium" | "high";

export interface CodDecision {
  readonly available: boolean;
  /** Handling fee in paise. Zero when COD is free or unavailable. */
  readonly fee: number;
  /**
   * Extra step required before the order is accepted.
   * `otp` — confirm by WhatsApp/SMS. `partial-payment` — take a deposit first.
   */
  readonly verification: "none" | "otp" | "partial-payment";
  /** Deposit in paise when verification is `partial-payment`. */
  readonly partialPayment: number;
  /** Why COD was withheld. Present only when `available` is false. */
  readonly reason?: string;
}

/**
 * Runtime overrides for the compiled defaults below.
 *
 * The caps are an operational dial — the weekly RTO review moves them without
 * a deploy (eng review 5A) — so the API passes the settings-table values here.
 * Absent fields fall back to the constants, which keeps this function pure and
 * the defaults reviewable in one place.
 */
export interface CodLimits {
  readonly minOrder?: number;
  readonly maxOrder?: number;
  readonly fee?: number;
}

export interface CodInput {
  /** Order value in paise, tax-inclusive. */
  readonly subtotal: number;
  /** Whether the courier serves this pincode for COD at all. */
  readonly pincodeCodServiceable: boolean;
  readonly rtoRisk: RtoRisk;
  /** Delivered orders this customer has already paid for. */
  readonly successfulOrders?: number;
  readonly limits?: CodLimits;
}

/** COD is not offered below this value — the fee would exceed the margin. */
export const COD_MIN_ORDER = 49900;

/** Nor above it, where an RTO loses too much to risk on an unverified buyer. */
export const COD_MAX_ORDER = 1000000;

export const COD_FEE = 4900;

/** Deposit taken on high-risk orders to establish commitment. */
export const COD_PARTIAL_PAYMENT = 9900;

/** Repeat customers with this many delivered orders stop paying the COD fee. */
export const COD_TRUSTED_ORDER_COUNT = 3;

const UNAVAILABLE = {
  available: false,
  fee: 0,
  verification: "none",
  partialPayment: 0,
} as const;

/** Whole rupees for a reason string — "10,000", never paise. */
function rupees(paise: number): string {
  return Math.round(paise / 100).toLocaleString("en-IN");
}

export function evaluateCod(input: CodInput): CodDecision {
  const { subtotal, pincodeCodServiceable, rtoRisk, successfulOrders = 0 } = input;
  const minOrder = input.limits?.minOrder ?? COD_MIN_ORDER;
  const maxOrder = input.limits?.maxOrder ?? COD_MAX_ORDER;
  const fee = input.limits?.fee ?? COD_FEE;

  if (!pincodeCodServiceable) {
    return { ...UNAVAILABLE, reason: "Not available for this pincode" };
  }
  if (subtotal < minOrder) {
    return { ...UNAVAILABLE, reason: `Not available on orders under ₹${rupees(minOrder)}` };
  }
  if (subtotal > maxOrder) {
    return { ...UNAVAILABLE, reason: `Not available on orders over ₹${rupees(maxOrder)}` };
  }

  // High risk is not refused outright — a deposit converts it into a
  // commitment, which recovers the order instead of losing the sale.
  if (rtoRisk === "high") {
    return {
      available: true,
      fee,
      verification: "partial-payment",
      partialPayment: COD_PARTIAL_PAYMENT,
    };
  }

  const trusted = successfulOrders >= COD_TRUSTED_ORDER_COUNT;

  return {
    available: true,
    fee: trusted ? 0 : fee,
    // A trusted repeat buyer has already proven intent, so the OTP step is
    // friction with nothing to catch.
    verification: rtoRisk === "medium" && !trusted ? "otp" : "none",
    partialPayment: 0,
  };
}

/** Saving offered for switching to prepaid — the COD fee, plus faster dispatch. */
export function prepaidIncentive(decision: CodDecision): number {
  return decision.fee;
}
