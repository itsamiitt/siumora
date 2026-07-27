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

export interface CodInput {
  /** Order value in paise, tax-inclusive. */
  readonly subtotal: number;
  /** Whether the courier serves this pincode for COD at all. */
  readonly pincodeCodServiceable: boolean;
  readonly rtoRisk: RtoRisk;
  /** Delivered orders this customer has already paid for. */
  readonly successfulOrders?: number;
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

export function evaluateCod(input: CodInput): CodDecision {
  const { subtotal, pincodeCodServiceable, rtoRisk, successfulOrders = 0 } = input;

  if (!pincodeCodServiceable) {
    return { ...UNAVAILABLE, reason: "Not available for this pincode" };
  }
  if (subtotal < COD_MIN_ORDER) {
    return { ...UNAVAILABLE, reason: "Not available on orders under ₹499" };
  }
  if (subtotal > COD_MAX_ORDER) {
    return { ...UNAVAILABLE, reason: "Not available on orders over ₹10,000" };
  }

  // High risk is not refused outright — a deposit converts it into a
  // commitment, which recovers the order instead of losing the sale.
  if (rtoRisk === "high") {
    return {
      available: true,
      fee: COD_FEE,
      verification: "partial-payment",
      partialPayment: COD_PARTIAL_PAYMENT,
    };
  }

  const trusted = successfulOrders >= COD_TRUSTED_ORDER_COUNT;

  return {
    available: true,
    fee: trusted ? 0 : COD_FEE,
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
