import type { OrderStatus } from "./order.ts";

/**
 * COD remittance reconciliation.
 *
 * The courier collects cash at the door, keeps it for four to seven days, nets
 * off freight and its own COD charge, and pays the rest. Nobody sends a
 * statement that says "here is what we owe you" — they send a file of rows, and
 * the seller is expected to notice when one is wrong.
 *
 * Two different comparisons live in that file and conflating them is the usual
 * mistake:
 *
 * - **Collected against expected.** This is real money. If the agent collected
 *   ₹1,890 on a ₹1,939 invoice, ₹49 is gone and somebody has to chase it.
 * - **Remitted against collected.** This is *supposed* to differ — the gap is
 *   the courier's freight and handling. It is only a problem when the deduction
 *   is larger than the rate card says, which is what the weight-discrepancy
 *   dispute tracker in plan/07 is for.
 *
 * Everything here is a pure function over rows, so a month of remittances can
 * be reconciled without a database and the arithmetic can be checked directly.
 */

export type RemittanceOutcome =
  /** Collected exactly what the invoice said. */
  | "matched"
  /** Collected less than the invoice. Real money missing. */
  | "short"
  /** Collected more than the invoice. Usually a keying error, still wrong. */
  | "over"
  /** No such order. The file is describing something this shop did not sell. */
  | "unknown_order"
  /** The order was prepaid — nothing should have been collected at the door. */
  | "not_cod"
  /** The parcel was never delivered, so there was nothing to collect. */
  | "not_delivered"
  /** Already reconciled in an earlier batch. Paying twice is not a windfall. */
  | "duplicate";

/** A row as it arrives from the courier. */
export interface RemittanceRow {
  readonly orderNumber: string;
  /** Cash taken at the door, in paise. */
  readonly collected: number;
  /** What the courier kept — freight plus its COD charge, in paise. */
  readonly deductions: number;
  /** What actually landed in the bank, in paise. */
  readonly remitted: number;
  /** Weight declared at booking, in grams. */
  readonly declaredWeightGrams?: number;
  /** Weight the courier billed on. Higher than declared is a dispute. */
  readonly chargedWeightGrams?: number;
}

/** What the shop believes about an order, for the row to be judged against. */
export interface ExpectedOrder {
  readonly orderNumber: string;
  readonly total: number;
  readonly paymentMethod: string;
  readonly status: OrderStatus;
  /** True when an earlier batch already reconciled this order. */
  readonly alreadyReconciled?: boolean;
}

export interface ReconciledRow {
  readonly row: RemittanceRow;
  readonly outcome: RemittanceOutcome;
  /** Expected collection in paise; zero when there is no matching order. */
  readonly expected: number;
  /** Collected minus expected. Negative is a shortfall. */
  readonly variance: number;
  /** Grams billed above what was declared. Zero when there is no discrepancy. */
  readonly excessWeightGrams: number;
  /** Plain-language reason, for the operator working the queue. */
  readonly note?: string;
}

/**
 * Deductions above this share of the collected amount are flagged.
 *
 * Not a rate card — the real one is per lane and per courier, and inventing
 * numbers for it would produce confident nonsense. This is a coarse sanity
 * bound: a courier keeping more than a third of a jewellery order has either
 * mis-weighed it or billed the wrong lane.
 */
export const DEDUCTION_ALARM_RATIO = 0.33;

export interface ReconciliationSummary {
  readonly rows: readonly ReconciledRow[];
  /** Total cash the courier says it collected. */
  readonly collected: number;
  /** Total the invoices said should have been collected, for matched orders. */
  readonly expected: number;
  /** Total that reached the bank. */
  readonly remitted: number;
  readonly deductions: number;
  /** Sum of every shortfall, as a positive number. Money to chase. */
  readonly shortfall: number;
  readonly counts: Readonly<Record<RemittanceOutcome, number>>;
  /** Rows worth a human's attention, in the order they should be worked. */
  readonly exceptions: readonly ReconciledRow[];
  /** Rows where the courier billed on more weight than was declared. */
  readonly weightDisputes: readonly ReconciledRow[];
}

const OUTCOMES: readonly RemittanceOutcome[] = [
  "matched",
  "short",
  "over",
  "unknown_order",
  "not_cod",
  "not_delivered",
  "duplicate",
];

/** Worst first: money missing outranks a keying error. */
const SEVERITY: Record<RemittanceOutcome, number> = {
  short: 0,
  unknown_order: 1,
  not_delivered: 2,
  duplicate: 3,
  not_cod: 4,
  over: 5,
  matched: 6,
};

export function reconcileRemittance(
  rows: readonly RemittanceRow[],
  orders: readonly ExpectedOrder[],
): ReconciliationSummary {
  const byNumber = new Map(orders.map((order) => [order.orderNumber, order]));
  // A file that lists the same order twice is itself a duplicate, even if the
  // ledger has never seen it — the second row is not a second sale.
  const seen = new Set<string>();

  const reconciled = rows.map((row): ReconciledRow => {
    const order = byNumber.get(row.orderNumber);
    const excessWeightGrams = Math.max(
      0,
      (row.chargedWeightGrams ?? 0) - (row.declaredWeightGrams ?? 0),
    );

    const base = { row, excessWeightGrams };

    if (!order) {
      return {
        ...base,
        outcome: "unknown_order",
        expected: 0,
        variance: row.collected,
        note: "No order with that number.",
      };
    }

    if (seen.has(row.orderNumber) || order.alreadyReconciled) {
      return {
        ...base,
        outcome: "duplicate",
        // Zero, not the order total: a duplicate contributes nothing, and
        // counting it would double the expected figure — the exact
        // double-count this branch exists to catch.
        expected: 0,
        variance: 0,
        note: `Already reconciled (invoice ${order.total} paise) — do not credit twice.`,
      };
    }
    seen.add(row.orderNumber);

    if (order.paymentMethod !== "cod") {
      return {
        ...base,
        outcome: "not_cod",
        expected: 0,
        variance: row.collected,
        note: "Order was prepaid; nothing was due at the door.",
      };
    }

    if (order.status !== "delivered") {
      return {
        ...base,
        outcome: "not_delivered",
        expected: 0,
        variance: row.collected,
        note: `Order is ${order.status.replace(/_/g, " ")}, so nothing was collectable.`,
      };
    }

    const variance = row.collected - order.total;

    return {
      ...base,
      outcome: variance === 0 ? "matched" : variance < 0 ? "short" : "over",
      expected: order.total,
      variance,
      ...(variance !== 0
        ? {
            note:
              variance < 0
                ? `Short by ${Math.abs(variance)} paise.`
                : `Over by ${variance} paise.`,
          }
        : {}),
    };
  });

  const counts = Object.fromEntries(
    OUTCOMES.map((outcome) => [
      outcome,
      reconciled.filter((entry) => entry.outcome === outcome).length,
    ]),
  ) as Record<RemittanceOutcome, number>;

  return {
    rows: reconciled,
    collected: sum(rows, (row) => row.collected),
    // Only over rows that genuinely had something to collect, or the total
    // would count orders that were never COD in the first place.
    expected: sum(reconciled, (entry) => entry.expected),
    remitted: sum(rows, (row) => row.remitted),
    deductions: sum(rows, (row) => row.deductions),
    shortfall: sum(reconciled, (entry) =>
      entry.outcome === "short" ? -entry.variance : 0,
    ),
    counts,
    exceptions: reconciled
      .filter((entry) => entry.outcome !== "matched")
      .sort((a, b) => SEVERITY[a.outcome] - SEVERITY[b.outcome]),
    weightDisputes: reconciled.filter((entry) => entry.excessWeightGrams > 0),
  };
}

/** Rows where the courier kept an implausible share of the order. */
export function overDeducted(
  rows: readonly RemittanceRow[],
  ratio = DEDUCTION_ALARM_RATIO,
): RemittanceRow[] {
  return rows.filter(
    (row) => row.collected > 0 && row.deductions / row.collected > ratio,
  );
}

export interface CashPosition {
  /** Prepaid orders already delivered — money long since settled. */
  readonly prepaidSettled: number;
  /** COD parcels still moving. Nothing has been collected yet. */
  readonly codInTransit: number;
  /** COD delivered, cash with the courier, not yet remitted. */
  readonly codAwaitingRemittance: number;
  /** COD delivered and reconciled against a remittance. */
  readonly codRemitted: number;
}

export interface CashPositionOrder {
  readonly total: number;
  readonly paymentMethod: string;
  readonly status: OrderStatus;
  readonly reconciled?: boolean;
}

/**
 * Where the money is, today.
 *
 * The daily digest plan/05 §4 asks for. The distinction that matters is between
 * cash the shop has and cash somebody else is holding: COD delivered but not
 * remitted is revenue on the books and nothing in the bank, and a shop that
 * cannot see that number plans against money it does not have.
 */
export function cashPosition(
  orders: readonly CashPositionOrder[],
): CashPosition {
  let prepaidSettled = 0;
  let codInTransit = 0;
  let codAwaitingRemittance = 0;
  let codRemitted = 0;

  for (const order of orders) {
    const isCod = order.paymentMethod === "cod";

    if (!isCod) {
      if (order.status === "delivered") prepaidSettled += order.total;
      continue;
    }

    if (order.status === "delivered") {
      if (order.reconciled) codRemitted += order.total;
      else codAwaitingRemittance += order.total;
      continue;
    }

    // Anything still moving. A parcel in NDR is in transit too — it has not
    // come back and it has not been paid for.
    if (
      order.status === "shipped" ||
      order.status === "out_for_delivery" ||
      order.status === "ndr" ||
      order.status === "processing" ||
      order.status === "confirmed"
    ) {
      codInTransit += order.total;
    }
  }

  return { prepaidSettled, codInTransit, codAwaitingRemittance, codRemitted };
}

function sum<T>(items: readonly T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}
