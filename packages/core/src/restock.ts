import type { OrderStatus } from "./order.ts";

/**
 * When stock goes back on the shelf.
 *
 * Stock leaves at placement, not at dispatch — anything later oversells the
 * window between the two. The counterpart was missing: nothing ever put it
 * back, so every cancelled, returned or returned-to-origin parcel permanently
 * lost a unit from the sellable count.
 *
 * The answer depends on where the order was when it ended, not on where it
 * ended up. An order cancelled before it was packed has goods that never left
 * the building. An order cancelled out of a failed delivery has goods sitting
 * in a courier's van, and counting those as sellable would promise a piece that
 * is three days away and may arrive damaged.
 */

export type RestockTiming =
  /** Goods never left. Put them back now. */
  | "immediate"
  /** Goods are travelling back. Put them back when they are received and pass QC. */
  | "on-receipt"
  /** Nothing to put back — the order is still live, or was never stocked out. */
  | "none";

/** Statuses in which the goods are still in the building. */
const NOT_YET_DISPATCHED: readonly OrderStatus[] = [
  "pending_payment",
  "awaiting_cod_confirmation",
  "confirmed",
  "processing",
];

export function restockTiming(
  from: OrderStatus,
  to: OrderStatus,
): RestockTiming {
  // A parcel coming back is not stock until somebody has it in their hands.
  if (to === "rto" || to === "returned") return "on-receipt";

  if (to === "cancelled") {
    return NOT_YET_DISPATCHED.includes(from) ? "immediate" : "on-receipt";
  }

  return "none";
}

/** Whether an order in this state is ever going to yield stock back. */
export function awaitsRestock(status: OrderStatus): boolean {
  return status === "rto" || status === "returned" || status === "cancelled";
}
