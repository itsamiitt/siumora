import type { OrderStatus, PaymentMethod } from "./order.ts";

/**
 * Returns and exchanges.
 *
 * The rules here are the ones published on the returns page. That is not a
 * coincidence and it is not optional: a policy the code does not honour is a
 * promise the business breaks, and the customer finds out at the worst moment.
 * If the published window or the hygiene exception changes, it changes here.
 */

export const RETURN_WINDOW_DAYS = 7;

/** Refunds are promised within this many working days of the piece arriving. */
export const REFUND_WORKING_DAYS = 5;

/** Damage must be reported quickly enough that it is attributable to transit. */
export const DAMAGE_REPORT_HOURS = 48;

export type ReturnReason =
  | "damaged"
  | "wrong_item"
  | "not_as_described"
  | "changed_mind"
  | "size_or_fit"
  | "quality";

export type ReturnResolution = "refund" | "exchange";

export interface ReturnEligibilityInput {
  readonly orderStatus: OrderStatus;
  /** When the parcel was delivered. */
  readonly deliveredAt: Date;
  /** Evaluated against this. Injected so the rule is testable. */
  readonly now: Date;
  readonly reason: ReturnReason;
  /**
   * True for pierced jewellery. The published policy refuses these once the
   * seal is broken, for hygiene, so the code has to know which pieces those are.
   */
  readonly isPiercedJewellery: boolean;
  /** Whether the customer confirms the hygiene seal is intact. */
  readonly sealIntact?: boolean;
  readonly paymentMethod: PaymentMethod;
}

export interface ReturnEligibility {
  readonly eligible: boolean;
  /** Reason it was refused, in words the customer can act on. */
  readonly refusal?: string;
  /** Where the money goes back to. */
  readonly refundTo?: "original_payment_method" | "upi";
  /** True when the policy approves without a human looking at it. */
  readonly autoApproved: boolean;
  /** Whether we pay the return shipping. */
  readonly freeReturnShipping: boolean;
}

/** Whole days elapsed, floor — a return on day 7 is inside a 7-day window. */
export function daysSince(from: Date, now: Date): number {
  return Math.floor((now.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Faults are ours; second thoughts are the customer's.
 *
 * Drives who pays return shipping and whether the hygiene exception applies —
 * refusing a return on a damaged pair of earrings because the seal is broken
 * would be using a hygiene rule to dodge a defect.
 */
export function isFault(reason: ReturnReason): boolean {
  return (
    reason === "damaged" || reason === "wrong_item" || reason === "not_as_described"
  );
}

export function evaluateReturn(
  input: ReturnEligibilityInput,
): ReturnEligibility {
  const {
    orderStatus,
    deliveredAt,
    now,
    reason,
    isPiercedJewellery,
    sealIntact,
    paymentMethod,
  } = input;

  if (orderStatus !== "delivered") {
    return {
      eligible: false,
      refusal: "This order has not been delivered yet.",
      autoApproved: false,
      freeReturnShipping: false,
    };
  }

  const elapsed = daysSince(deliveredAt, now);

  if (elapsed < 0) {
    return {
      eligible: false,
      refusal: "This order has not been delivered yet.",
      autoApproved: false,
      freeReturnShipping: false,
    };
  }

  if (elapsed > RETURN_WINDOW_DAYS) {
    return {
      eligible: false,
      refusal: `Returns close ${RETURN_WINDOW_DAYS} days after delivery. This one was delivered ${elapsed} days ago.`,
      autoApproved: false,
      freeReturnShipping: false,
    };
  }

  // Damage has a tighter clock, because after a couple of days it can no longer
  // be attributed to transit.
  if (reason === "damaged" && elapsed * 24 > DAMAGE_REPORT_HOURS) {
    return {
      eligible: false,
      refusal: `Damage in transit must be reported within ${DAMAGE_REPORT_HOURS} hours of delivery.`,
      autoApproved: false,
      freeReturnShipping: false,
    };
  }

  // Hygiene exception — applies to change-of-mind returns only. A faulty or
  // wrong item comes back regardless of the seal.
  if (isPiercedJewellery && !isFault(reason) && sealIntact === false) {
    return {
      eligible: false,
      refusal:
        "For hygiene reasons pierced jewellery can only be returned with the seal unbroken.",
      autoApproved: false,
      freeReturnShipping: false,
    };
  }

  const fault = isFault(reason);

  return {
    eligible: true,
    // COD orders never had a payment instrument to refund to, so the money goes
    // back by UPI.
    refundTo: paymentMethod === "cod" ? "upi" : "original_payment_method",
    autoApproved: true,
    freeReturnShipping: fault,
  };
}

export type RmaStatus =
  | "requested"
  | "approved"
  | "pickup_scheduled"
  | "in_transit"
  | "received"
  | "refunded"
  | "exchanged"
  | "rejected";

const RMA_TRANSITIONS: Record<RmaStatus, readonly RmaStatus[]> = {
  requested: ["approved", "rejected"],
  approved: ["pickup_scheduled", "rejected"],
  pickup_scheduled: ["in_transit", "rejected"],
  in_transit: ["received"],
  // Quality check happens on receipt, so a return can still be rejected here.
  received: ["refunded", "exchanged", "rejected"],
  refunded: [],
  exchanged: [],
  rejected: [],
};

export function canTransitionRma(from: RmaStatus, to: RmaStatus): boolean {
  return RMA_TRANSITIONS[from].includes(to);
}

export function transitionRma(from: RmaStatus, to: RmaStatus): RmaStatus {
  if (!canTransitionRma(from, to)) {
    throw new Error(`illegal return transition: ${from} -> ${to}`);
  }
  return to;
}

export interface ReturnRequest {
  readonly id: string;
  readonly orderNumber: string;
  readonly variantIds: readonly string[];
  readonly reason: ReturnReason;
  readonly resolution: ReturnResolution;
  readonly note?: string;
  readonly status: RmaStatus;
  readonly refundTo: "original_payment_method" | "upi";
  readonly freeReturnShipping: boolean;
  readonly createdAt: string;
}

export const RETURN_REASON_LABELS: Record<ReturnReason, string> = {
  damaged: "It arrived damaged",
  wrong_item: "Wrong item sent",
  not_as_described: "Not as described",
  changed_mind: "Changed my mind",
  size_or_fit: "Size or fit",
  quality: "Not happy with the quality",
};
