import type { CartLine, CartTotals } from "./cart.ts";
import type { NdrReason } from "./ndr.ts";

/**
 * Order model and its lifecycle.
 *
 * The transitions mirror plan/05: a prepaid order ships once captured; a COD
 * order passes through RTO gating first, and a failed delivery attempt goes to
 * NDR rather than straight to a return, because most failures are a missed
 * phone call and are recoverable within minutes.
 */

export type OrderStatus =
  | "pending_payment"
  | "confirmed"
  | "awaiting_cod_confirmation"
  | "processing"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "ndr"
  | "rto"
  | "cancelled"
  | "returned";

export type PaymentMethod = "upi" | "card" | "netbanking" | "wallet" | "cod";

/**
 * Allowed transitions.
 *
 * Encoded as data so an illegal move — marking an unpaid order delivered, or
 * reviving a cancelled one — fails loudly instead of corrupting the record that
 * finance and the courier both read.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ["confirmed", "awaiting_cod_confirmation", "cancelled"],
  awaiting_cod_confirmation: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["out_for_delivery", "ndr", "rto"],
  out_for_delivery: ["delivered", "ndr"],
  ndr: ["out_for_delivery", "rto", "cancelled"],
  delivered: ["returned"],
  rto: [],
  cancelled: [],
  returned: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(from: OrderStatus, to: OrderStatus): OrderStatus {
  if (!canTransition(from, to)) {
    throw new Error(`illegal order transition: ${from} -> ${to}`);
  }
  return to;
}

/** Terminal states never move again. */
export function isTerminal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Whether revenue from this order should be counted as real. */
export function isRevenueRecognised(status: OrderStatus): boolean {
  return status === "delivered";
}

export interface ShippingAddress {
  readonly name: string;
  readonly phone: string;
  readonly line1: string;
  readonly line2?: string;
  readonly landmark?: string;
  readonly city: string;
  readonly stateCode: string;
  readonly pincode: string;
}

export interface Order {
  readonly id: string;
  /** Customer-facing number, e.g. SIU-00123. */
  readonly number: string;
  readonly status: OrderStatus;
  readonly lines: readonly CartLine[];
  readonly totals: CartTotals;
  readonly paymentMethod: PaymentMethod;
  readonly address: ShippingAddress;
  /** True when the delivery state differs from Maharashtra. */
  readonly interState: boolean;
  readonly placedAt: string;
  /** Set when the courier confirms delivery. Starts the returns clock. */
  readonly deliveredAt?: string;
  /** Failed delivery attempts so far. */
  readonly deliveryAttempts?: number;
  /** Why the most recent attempt failed. */
  readonly ndrReason?: NdrReason;
  /** Shared analytics dedup id, persisted so retries reuse it. */
  readonly eventId: string;
  /** Invoice number, assigned once the order is confirmed. */
  readonly invoiceNumber?: string;
}

/**
 * The status a freshly placed order starts in.
 *
 * A COD order that needs verification must not enter the fulfilment queue yet —
 * picking and packing it before the customer confirms is exactly how an RTO
 * gets manufactured.
 */
export function initialStatus(
  paymentMethod: PaymentMethod,
  options: { requiresCodConfirmation: boolean },
): OrderStatus {
  if (paymentMethod !== "cod") return "pending_payment";
  return options.requiresCodConfirmation
    ? "awaiting_cod_confirmation"
    : "confirmed";
}
