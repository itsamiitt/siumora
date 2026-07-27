import "server-only";

import {
  calculateTotals,
  canTransition,
  initialStatus,
  invoiceNumber,
  isInterState,
  orderNumber,
  shippingFor,
  transition,
  ndrState,
  outcomeFor,
  type NdrAction,
  type NdrReason,
  type Order,
  type OrderStatus,
  type PaymentMethod,
  type ShippingAddress,
} from "@siumora/core";

import { getCartLines } from "./cart-store";

/**
 * Order persistence.
 *
 * Medusa owns this in production. Held in a global map for now for the same
 * reason as the cart: Next instantiates a module more than once across route
 * handler and page bundles, so a plain module constant silently splits in two.
 */

const globalForOrders = globalThis as typeof globalThis & {
  __siumoraOrders?: Map<string, Order>;
  __siumoraOrderSeq?: { value: number };
};

const ORDERS: Map<string, Order> = (globalForOrders.__siumoraOrders ??= new Map());

/**
 * Order and invoice sequences.
 *
 * A real deployment takes these from a database sequence, not a counter in
 * memory: invoice numbers must be gapless and unique per financial year, and
 * two processes sharing a process-local counter would issue the same number
 * twice.
 */
const SEQUENCE = (globalForOrders.__siumoraOrderSeq ??= { value: 0 });

export interface PlaceOrderInput {
  readonly address: ShippingAddress;
  readonly paymentMethod: PaymentMethod;
  readonly requiresCodConfirmation: boolean;
  readonly eventId: string;
  readonly codFee?: number;
}

export async function placeOrder(
  input: PlaceOrderInput,
): Promise<{ ok: true; order: Order } | { ok: false; message: string }> {
  const lines = await getCartLines();
  if (lines.length === 0) return { ok: false, message: "Your bag is empty." };

  const interState = isInterState(input.address.stateCode);
  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

  const totals = calculateTotals(lines, {
    interState,
    shipping: shippingFor(subtotal),
    codFee: input.codFee ?? 0,
  });

  const sequence = ++SEQUENCE.value;
  const placedAt = new Date();

  const status = initialStatus(input.paymentMethod, {
    requiresCodConfirmation: input.requiresCodConfirmation,
  });

  const order: Order = {
    id: crypto.randomUUID(),
    number: orderNumber(sequence),
    status,
    lines,
    totals,
    paymentMethod: input.paymentMethod,
    address: input.address,
    interState,
    placedAt: placedAt.toISOString(),
    eventId: input.eventId,
    // The invoice is only raised once the order is actually confirmed. Issuing
    // one for an order still awaiting COD confirmation would burn a number in
    // a sequence that has to stay gapless.
    ...(status === "confirmed"
      ? { invoiceNumber: invoiceNumber(sequence, placedAt) }
      : {}),
  };

  ORDERS.set(order.number, order);
  return { ok: true, order };
}

export async function getOrder(number: string): Promise<Order | undefined> {
  return ORDERS.get(number);
}

/**
 * Confirm an order that was held for COD verification.
 *
 * Stands in for the WhatsApp OTP callback described in plan/06 — the transport
 * differs, the state change does not. The invoice number is assigned here
 * rather than at placement because a held order that is never confirmed must
 * not burn a number out of a sequence that has to stay gapless.
 */
export async function confirmOrder(
  number: string,
): Promise<{ ok: true; order: Order } | { ok: false; message: string }> {
  const existing = ORDERS.get(number);
  if (!existing) return { ok: false, message: "Order not found." };

  if (!canTransition(existing.status, "confirmed")) {
    return {
      ok: false,
      message: `Order ${number} cannot be confirmed from ${existing.status}.`,
    };
  }

  const confirmed: Order = {
    ...existing,
    status: transition(existing.status, "confirmed"),
    invoiceNumber:
      existing.invoiceNumber ??
      invoiceNumber(sequenceOf(existing.number), new Date(existing.placedAt)),
  };

  ORDERS.set(number, confirmed);
  return { ok: true, order: confirmed };
}

/** Recover the numeric sequence from a customer-facing order number. */
function sequenceOf(orderNo: string): number {
  const digits = orderNo.replace(/\D/g, "");
  return Number.parseInt(digits, 10) || 1;
}

/**
 * Advance an order to the next state.
 *
 * Stands in for the courier webhook — Shiprocket drives these transitions in
 * production. Exposed so the lifecycle, and everything gated on it such as
 * returns, can be exercised without a courier account. The transition itself
 * is validated by the same rules the real webhook would go through.
 */
export async function advanceOrder(
  number: string,
  to: OrderStatus,
  ndrReason?: NdrReason,
): Promise<{ ok: true; order: Order } | { ok: false; message: string }> {
  const existing = ORDERS.get(number);
  if (!existing) return { ok: false, message: "Order not found." };

  if (!canTransition(existing.status, to)) {
    return {
      ok: false,
      message: `Cannot move ${number} from ${existing.status} to ${to}.`,
    };
  }

  const attempts =
    to === "ndr" ? (existing.deliveryAttempts ?? 0) + 1 : existing.deliveryAttempts;
  const reason =
    to === "ndr"
      ? (ndrReason ?? existing.ndrReason ?? "customer_unavailable")
      : existing.ndrReason;

  let status = transition(existing.status, to);

  // An attempt that cannot be recovered — the ceiling reached, or the parcel
  // refused — goes straight on to RTO. Leaving it sitting in NDR would show
  // "delivery attempted" on an order that is already travelling back, and the
  // customer would keep being offered choices that no longer exist.
  if (to === "ndr" && attempts !== undefined) {
    const outcome = outcomeFor(attempts, reason ?? "customer_unavailable");
    if (outcome === "rto" && canTransition(status, "rto")) {
      status = transition(status, "rto");
    }
  }

  const next: Order = {
    ...existing,
    status,
    // The returns window runs from delivery, so the timestamp is recorded the
    // moment the courier says it landed.
    ...(to === "delivered" ? { deliveredAt: new Date().toISOString() } : {}),
    ...(attempts !== undefined ? { deliveryAttempts: attempts } : {}),
    ...(reason !== undefined ? { ndrReason: reason } : {}),
  };

  ORDERS.set(number, next);
  return { ok: true, order: next };
}

/** The next states an order may legally move to. Drives the admin control. */
export function nextStatuses(status: OrderStatus): OrderStatus[] {
  return (
    [
      "confirmed",
      "processing",
      "shipped",
      "out_for_delivery",
      "delivered",
      "ndr",
      "rto",
      "cancelled",
      "returned",
    ] as OrderStatus[]
  ).filter((candidate) => canTransition(status, candidate));
}

/** All orders, newest first. Stands in for a customer-scoped query. */
export async function listOrders(): Promise<Order[]> {
  return [...ORDERS.values()].sort((a, b) =>
    b.placedAt.localeCompare(a.placedAt),
  );
}

/**
 * Record the customer's answer to a failed delivery.
 *
 * `reattempt` and `update_address` put the parcel back out for delivery;
 * `cancel` ends it. The attempt counter is not reset — the courier's ceiling
 * is a real limit, and pretending otherwise would promise a delivery that
 * cannot happen.
 */
export async function resolveNdr(
  number: string,
  action: NdrAction,
): Promise<{ ok: true; order: Order } | { ok: false; message: string }> {
  const existing = ORDERS.get(number);
  if (!existing) return { ok: false, message: "Order not found." };
  if (existing.status !== "ndr") {
    return { ok: false, message: "This order is not awaiting a delivery answer." };
  }

  const state = ndrState(
    existing.deliveryAttempts ?? 0,
    existing.ndrReason ?? "customer_unavailable",
  );

  if (action === "cancel") {
    return advanceOrder(number, "cancelled");
  }

  if (!state.recoverable) {
    return {
      ok: false,
      message: "The courier cannot attempt this delivery again.",
    };
  }

  return advanceOrder(number, "out_for_delivery");
}
