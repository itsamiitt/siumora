import type { RtoRisk } from "./cod.ts";

/**
 * Return-to-origin risk scoring.
 *
 * An RTO costs freight both ways plus handling and the capital tied up in the
 * journey, and returns nothing — so every point of RTO removed is worth roughly
 * twice the freight. This engine decides whether an order ships on trust, needs
 * a confirmation, or needs money up front.
 *
 * Transparent weighted rules on purpose. A trained model comes later, once
 * there are enough labelled outcomes to train on; until then an ops person must
 * be able to read a decision and see why it went that way, which is also what
 * makes the rules tunable from real `ndr_events` data.
 */

export interface RtoFactors {
  /** Prepaid orders carry almost no RTO risk — the money is already taken. */
  readonly paymentMethod: "prepaid" | "cod";
  /** Order value in paise. */
  readonly orderValue: number;
  /** Address quality from `scoreAddress`, 0–100. */
  readonly addressScore: number;
  /** Delivered orders this customer has paid for. */
  readonly successfulOrders?: number;
  /** Orders this customer has previously sent back to origin. */
  readonly previousRtos?: number;
  /**
   * Historical RTO rate for the destination pincode, 0–1.
   * Undefined where there is no history yet.
   */
  readonly pincodeRtoRate?: number;
  /** Whether the phone number has been verified by OTP. */
  readonly phoneVerified?: boolean;
  /** True for a first-time buyer with no history at all. */
  readonly isNewCustomer?: boolean;
}

export interface RtoContribution {
  readonly factor: string;
  /** Points added to the risk score. Negative values reduce risk. */
  readonly points: number;
  readonly detail: string;
}

export interface RtoScore {
  /** 0–100. Higher means more likely to come back. */
  readonly score: number;
  readonly risk: RtoRisk;
  /** Every factor that moved the score, for the admin decision log. */
  readonly contributions: RtoContribution[];
}

/** Band thresholds. Tunable once real outcome labels exist. */
export const RTO_MEDIUM_THRESHOLD = 35;
export const RTO_HIGH_THRESHOLD = 60;

/** Orders above this value get extra scrutiny on COD. */
const HIGH_VALUE_PAISE = 500000;

export function scoreRto(factors: RtoFactors): RtoScore {
  const contributions: RtoContribution[] = [];
  const add = (factor: string, points: number, detail: string) => {
    if (points !== 0) contributions.push({ factor, points, detail });
  };

  // Prepaid short-circuits: the customer has already paid, so refusing the
  // parcel costs them money. Scoring it like COD would gate orders that carry
  // no risk and cost sales for nothing.
  if (factors.paymentMethod === "prepaid") {
    return {
      score: 0,
      risk: "low",
      contributions: [
        { factor: "payment", points: 0, detail: "Prepaid — payment already taken" },
      ],
    };
  }

  let score = 25;
  add("payment", 25, "Cash on delivery");

  // Address quality is the strongest controllable signal.
  if (factors.addressScore < 40) {
    score += 30;
    add("address", 30, `Address score ${factors.addressScore} — likely undeliverable`);
  } else if (factors.addressScore < 60) {
    score += 18;
    add("address", 18, `Address score ${factors.addressScore} — incomplete`);
  } else if (factors.addressScore >= 85) {
    score -= 8;
    add("address", -8, `Address score ${factors.addressScore} — complete`);
  }

  if (factors.orderValue > HIGH_VALUE_PAISE) {
    score += 12;
    add("value", 12, "High-value COD order");
  }

  // A customer's own record dominates any population average once it exists.
  const previousRtos = factors.previousRtos ?? 0;
  const successfulOrders = factors.successfulOrders ?? 0;

  if (previousRtos > 0) {
    // Weighted so that two prior returns reach the high band on their own,
    // even with a verified phone and a clean address. A repeat refuser passes
    // the OTP that the medium band asks for and then refuses the parcel again,
    // so anything short of a deposit does not actually stop the loss.
    const points = Math.min(45, previousRtos * 24);
    score += points;
    add("history", points, `${previousRtos} previous return${previousRtos > 1 ? "s" : ""} to origin`);
  }

  if (successfulOrders >= 3) {
    score -= 20;
    add("history", -20, `${successfulOrders} delivered orders`);
  } else if (successfulOrders > 0) {
    score -= 8;
    add("history", -8, `${successfulOrders} delivered order${successfulOrders > 1 ? "s" : ""}`);
  } else if (factors.isNewCustomer) {
    score += 8;
    add("history", 8, "First order — no history");
  }

  if (factors.pincodeRtoRate !== undefined) {
    if (factors.pincodeRtoRate >= 0.25) {
      score += 15;
      add("pincode", 15, `Pincode returns ${Math.round(factors.pincodeRtoRate * 100)}% of COD orders`);
    } else if (factors.pincodeRtoRate <= 0.05) {
      score -= 8;
      add("pincode", -8, "Pincode delivers reliably");
    }
  }

  // An unreachable phone is the leading cause of a failed delivery attempt.
  if (factors.phoneVerified) {
    score -= 10;
    add("contact", -10, "Phone verified by OTP");
  } else {
    score += 10;
    add("contact", 10, "Phone not verified");
  }

  const bounded = Math.max(0, Math.min(100, score));

  return {
    score: bounded,
    risk: bandFor(bounded),
    contributions,
  };
}

export function bandFor(score: number): RtoRisk {
  if (score >= RTO_HIGH_THRESHOLD) return "high";
  if (score >= RTO_MEDIUM_THRESHOLD) return "medium";
  return "low";
}

/** One-line explanation for the admin, highest-impact factor first. */
export function explainRto(result: RtoScore): string {
  const ranked = [...result.contributions].sort(
    (a, b) => Math.abs(b.points) - Math.abs(a.points),
  );
  const top = ranked.slice(0, 3).map((c) => c.detail);
  return `${result.risk.toUpperCase()} (${result.score}/100): ${top.join("; ")}`;
}
