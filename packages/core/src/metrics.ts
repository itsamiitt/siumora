import { isRevenueRecognised, type Order, type OrderStatus } from "./order.ts";

/**
 * Operational metrics.
 *
 * The one rule that governs everything here: **a COD parcel in transit is not
 * revenue.** Counting it is how RTO silently inflates the books — the money
 * only exists once the customer takes delivery and pays. Booked value and
 * recognised revenue are therefore reported as two different numbers, never
 * blended into one "sales" figure.
 */

export interface RevenueSummary {
  /** Value of orders placed, whether or not the money has arrived. */
  readonly booked: number;
  /** Value actually collected — delivered orders only. */
  readonly recognised: number;
  /** Booked value sitting in transit, still at risk of coming back. */
  readonly inFlight: number;
  /** Value lost to returns and cancellations. */
  readonly lost: number;
  readonly orderCount: number;
  /** Average order value on booked orders, in paise. Null with no orders. */
  readonly aov: number | null;
}

const LOST_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "rto",
  "cancelled",
  "returned",
]);

export function summariseRevenue(orders: readonly Order[]): RevenueSummary {
  let booked = 0;
  let recognised = 0;
  let lost = 0;

  for (const order of orders) {
    const value = order.totals.total;
    booked += value;

    if (isRevenueRecognised(order.status)) recognised += value;
    else if (LOST_STATUSES.has(order.status)) lost += value;
  }

  return {
    booked,
    recognised,
    // Whatever is neither collected nor written off is still moving.
    inFlight: booked - recognised - lost,
    lost,
    orderCount: orders.length,
    aov: orders.length > 0 ? Math.round(booked / orders.length) : null,
  };
}

export interface RtoBreakdown {
  readonly key: string;
  readonly orders: number;
  readonly returned: number;
  /** Share returned, 0–1. */
  readonly rate: number;
}

/**
 * RTO rate grouped by some key.
 *
 * Counts only orders that reached a settled outcome. Including parcels still
 * in transit in the denominator makes every rate look artificially good, which
 * is the opposite of useful when the whole point is spotting bad lanes early.
 */
export function rtoBreakdown(
  orders: readonly Order[],
  keyOf: (order: Order) => string,
): RtoBreakdown[] {
  const groups = new Map<string, { orders: number; returned: number }>();

  for (const order of orders) {
    const settled =
      order.status === "delivered" ||
      order.status === "rto" ||
      order.status === "returned";
    if (!settled) continue;

    const key = keyOf(order);
    const group = groups.get(key) ?? { orders: 0, returned: 0 };
    group.orders += 1;
    if (order.status === "rto") group.returned += 1;
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      orders: group.orders,
      returned: group.returned,
      rate: group.orders > 0 ? group.returned / group.orders : 0,
    }))
    .sort((a, b) => b.rate - a.rate || b.orders - a.orders);
}

/** Orders waiting on a customer answer after a failed delivery. */
export function ndrQueue(orders: readonly Order[]): Order[] {
  return orders
    .filter((order) => order.status === "ndr")
    .sort(
      (a, b) => (b.deliveryAttempts ?? 0) - (a.deliveryAttempts ?? 0),
    );
}

/** Count of orders in each status, for the ops board. */
export function statusCounts(
  orders: readonly Order[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const order of orders) {
    counts[order.status] = (counts[order.status] ?? 0) + 1;
  }
  return counts;
}

export interface InvoiceSeriesHealth {
  readonly issued: number;
  /** Sequence numbers missing from the series. */
  readonly gaps: number[];
  /** True when the series runs unbroken from 1. */
  readonly healthy: boolean;
}

/**
 * Invoice-series health.
 *
 * A GST invoice series has to be sequential and gapless within the financial
 * year. A gap is not cosmetic — it is the thing an assessing officer asks
 * about, so it needs surfacing the day it appears rather than at filing.
 */
export function invoiceSeriesHealth(
  orders: readonly Order[],
): InvoiceSeriesHealth {
  const sequences = orders
    .map((order) => order.invoiceNumber)
    .filter((n): n is string => Boolean(n))
    .map((n) => Number.parseInt(n.slice(n.lastIndexOf("/") + 1), 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  if (sequences.length === 0) {
    return { issued: 0, gaps: [], healthy: true };
  }

  const gaps: number[] = [];
  const highest = sequences[sequences.length - 1]!;
  const present = new Set(sequences);

  for (let n = 1; n <= highest; n++) {
    if (!present.has(n)) gaps.push(n);
  }

  return { issued: sequences.length, gaps, healthy: gaps.length === 0 };
}
