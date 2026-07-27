/**
 * Non-delivery reports and the recovery window.
 *
 * A failed delivery attempt is not a lost order — it is usually a missed phone
 * call, and answering it within minutes is the cheapest intervention in the
 * whole logistics chain. Every attempt that goes unanswered moves the parcel
 * closer to a return, which costs freight both ways and returns nothing.
 *
 * The rule that matters: couriers give a bounded number of attempts. Knowing
 * how many are left, and saying so, is what turns a shrug into a reply.
 */

export type NdrReason =
  | "customer_unavailable"
  | "phone_unreachable"
  | "address_incomplete"
  | "customer_refused"
  | "payment_not_ready"
  | "premises_closed";

/** Couriers typically allow three attempts before returning the parcel. */
export const MAX_DELIVERY_ATTEMPTS = 3;

export type NdrAction = "reattempt" | "update_address" | "cancel";

export interface NdrEvent {
  readonly id: string;
  readonly orderNumber: string;
  readonly reason: NdrReason;
  /** Which attempt failed — 1-based. */
  readonly attempt: number;
  readonly recordedAt: string;
  /** What the customer chose, once they respond. */
  readonly resolution?: NdrAction;
}

export const NDR_REASON_LABELS: Record<NdrReason, string> = {
  customer_unavailable: "Nobody was home",
  phone_unreachable: "We could not reach your phone",
  address_incomplete: "The courier could not find the address",
  customer_refused: "The parcel was refused",
  payment_not_ready: "Cash was not ready",
  premises_closed: "The premises were closed",
};

export interface NdrState {
  /** Attempts already made. */
  readonly attempts: number;
  readonly attemptsRemaining: number;
  /** True once the courier will not try again. */
  readonly exhausted: boolean;
  /** Whether the customer can still recover this delivery. */
  readonly recoverable: boolean;
  /** What the customer should be asked to do, most useful first. */
  readonly suggestedActions: readonly NdrAction[];
}

/**
 * Whether a reason can be fixed by trying again unchanged.
 *
 * An incomplete address cannot — re-sending to the same wrong address burns an
 * attempt and teaches the customer that replying is pointless. Those need the
 * address corrected first.
 */
export function needsAddressFix(reason: NdrReason): boolean {
  return reason === "address_incomplete";
}

/** A refusal is a decision, not a missed call. Do not badger the customer. */
export function isRefusal(reason: NdrReason): boolean {
  return reason === "customer_refused";
}

export function ndrState(
  attempts: number,
  latestReason: NdrReason,
): NdrState {
  const clamped = Math.max(0, attempts);
  const remaining = Math.max(0, MAX_DELIVERY_ATTEMPTS - clamped);
  const exhausted = remaining === 0;

  // A refused parcel is not recovered by another attempt; offering one wastes
  // a delivery and the customer's patience.
  const recoverable = !exhausted && !isRefusal(latestReason);

  const suggestedActions: NdrAction[] = [];
  if (recoverable) {
    if (needsAddressFix(latestReason)) {
      // Leading with "try again" on a bad address invites the same failure.
      suggestedActions.push("update_address", "reattempt");
    } else {
      suggestedActions.push("reattempt", "update_address");
    }
  }
  suggestedActions.push("cancel");

  return {
    attempts: clamped,
    attemptsRemaining: remaining,
    exhausted,
    recoverable,
    suggestedActions,
  };
}

/**
 * The order status implied by an NDR outcome.
 *
 * Exhausted attempts and an explicit refusal both go to RTO; anything else
 * stays in NDR waiting on the customer.
 */
export function outcomeFor(
  attempts: number,
  reason: NdrReason,
): "ndr" | "rto" {
  const state = ndrState(attempts, reason);
  return state.recoverable ? "ndr" : "rto";
}

/**
 * How urgently to chase, given attempts already spent.
 *
 * The last attempt is the one worth a phone call rather than another message —
 * after it the parcel goes back and the freight is spent either way.
 */
export function escalation(attempts: number): "message" | "message_and_call" {
  return attempts >= MAX_DELIVERY_ATTEMPTS - 1 ? "message_and_call" : "message";
}
