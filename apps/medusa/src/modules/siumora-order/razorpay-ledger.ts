/**
 * Every Razorpay order we ever create, and what became of it (security
 * review, item 2).
 *
 * Razorpay orders are created with payment_capture:1, and an order stays
 * payable after we stop pointing at it: the prepare route opens a fresh one
 * after 30 minutes or a changed total (service.ts updatePayment), and Medusa
 * drops the session that named the old one. A shopper who pays that old
 * order — a second tab, a stale modal — has money captured for an order id
 * no live session names, so neither the webhook (sessionForOrder) nor the
 * recon sweep (open sessions only) ever looks at it: no order, no refund.
 *
 * The ledger closes that hole. The provider writes a row for each Razorpay
 * order it creates; the prepare route stamps the cart; the recon job walks
 * the open rows past a grace period and asks Razorpay about each. Money on
 * an order that no Medusa payment recorded and no live session can still
 * complete is refunded, with a "[money-alert]" log line either way.
 *
 * Pure decision + raw SQL against the shared connection (the provider has no
 * query graph), so node --test pins the decision without a database.
 */

import type { PaymentReading } from "../razorpay-payment/decide.ts";

export type LedgerStatus = "open" | "completed" | "refunded" | "refund_failed" | "expired";

export interface LedgerRow {
  id: string;
  razorpay_order_id: string;
  cart_id: string | null;
  session_id: string | null;
  amount_paise: number;
  status: LedgerStatus;
  created_at: string | Date;
}

export interface RawClient {
  raw(sql: string, bindings?: ReadonlyArray<unknown>): Promise<{ rows: unknown[] }>;
}

/** How long a new Razorpay order is left alone: the shopper may still be paying. */
export const LEDGER_GRACE_MS = 30 * 60_000;
/** An order unpaid this long is done with (Razorpay orders do not expire on their own). */
export const LEDGER_EXPIRE_MS = 7 * 24 * 3_600_000;

export type LedgerAction = "wait" | "completed" | "refund" | "refunded" | "expired";

/**
 * What the sweep does with one open ledger row.
 *
 * - A Medusa payment carries this Razorpay order id → it became (or is
 *   becoming) an order; Medusa's own compensation refunds a failed one.
 * - Inside the grace period → wait.
 * - Nothing paid → wait, then expire.
 * - Refunded already → record it.
 * - Authorized only → wait: auto-capture lands it, or Razorpay releases it.
 * - Captured (or a wrong amount) while a live session on a still-open cart
 *   names the order → wait: the regular recon replay completes it.
 * - Captured with nothing left to complete it → refund.
 */
export function ledgerAction(input: {
  reading: PaymentReading;
  recorded: boolean;
  liveSession: boolean;
  cartCompleted: boolean;
  ageMs: number;
}): LedgerAction {
  if (input.recorded) return "completed";
  if (input.ageMs < LEDGER_GRACE_MS) return "wait";
  switch (input.reading.state) {
    case "pending":
      return input.ageMs > LEDGER_EXPIRE_MS ? "expired" : "wait";
    case "refunded":
      return "refunded";
    case "authorized":
      return "wait";
    case "captured":
    case "mismatch":
      return input.liveSession && !input.cartCompleted ? "wait" : "refund";
  }
}

/** The amount to send back: what was taken. */
export function refundPaise(reading: PaymentReading, row: Pick<LedgerRow, "amount_paise">): number {
  return reading.state === "mismatch" ? reading.amountPaise : row.amount_paise;
}

// ── SQL ────────────────────────────────────────────────────────────────────

function mintId(): string {
  return `sirzo_${crypto.randomUUID().replaceAll("-", "")}`;
}

/** The provider, right after Razorpay created the order. */
export async function recordLedgerOrder(
  pg: RawClient,
  input: { razorpayOrderId: string; amountPaise: number; sessionId: string | null; cartId?: string | null },
): Promise<void> {
  await pg.raw(
    `INSERT INTO siumora_razorpay_orders
       (id, razorpay_order_id, cart_id, session_id, amount_paise, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'open', now(), now())
     ON CONFLICT (razorpay_order_id) WHERE deleted_at IS NULL DO NOTHING`,
    [mintId(), input.razorpayOrderId, input.cartId ?? null, input.sessionId, input.amountPaise],
  );
}

/** The prepare route: which cart this Razorpay order was opened for. */
export async function stampLedgerCart(pg: RawClient, razorpayOrderId: string, cartId: string): Promise<void> {
  await pg.raw(
    `UPDATE siumora_razorpay_orders SET cart_id = COALESCE(cart_id, ?), updated_at = now()
      WHERE razorpay_order_id = ? AND deleted_at IS NULL`,
    [cartId, razorpayOrderId],
  );
}

export async function findLedgerOrder(pg: RawClient, razorpayOrderId: string): Promise<LedgerRow | undefined> {
  const result = await pg.raw(
    `SELECT id, razorpay_order_id, cart_id, session_id, amount_paise, status, created_at
       FROM siumora_razorpay_orders WHERE razorpay_order_id = ? AND deleted_at IS NULL`,
    [razorpayOrderId],
  );
  return result.rows[0] as LedgerRow | undefined;
}

/** Rows the sweep still owes a look: open, or a refund that failed last time. */
export async function openLedgerOrders(pg: RawClient, createdBefore: Date, limit = 200): Promise<LedgerRow[]> {
  const result = await pg.raw(
    `SELECT id, razorpay_order_id, cart_id, session_id, amount_paise, status, created_at
       FROM siumora_razorpay_orders
      WHERE status IN ('open', 'refund_failed') AND created_at <= ? AND deleted_at IS NULL
      ORDER BY created_at ASC LIMIT ?`,
    [createdBefore, limit],
  );
  return result.rows as LedgerRow[];
}

export async function settleLedgerOrder(
  pg: RawClient,
  razorpayOrderId: string,
  status: Exclude<LedgerStatus, "open">,
): Promise<void> {
  await pg.raw(
    `UPDATE siumora_razorpay_orders SET status = ?, updated_at = now()
      WHERE razorpay_order_id = ? AND deleted_at IS NULL`,
    [status, razorpayOrderId],
  );
}

/**
 * Where Medusa stands on one Razorpay order: a payment recorded for it, a
 * live session still naming it, and whether its cart already completed.
 */
export async function ledgerContext(
  pg: RawClient,
  row: Pick<LedgerRow, "razorpay_order_id" | "cart_id">,
): Promise<{ recorded: boolean; liveSession: boolean; cartCompleted: boolean }> {
  const result = await pg.raw(
    `SELECT
       EXISTS (SELECT 1 FROM payment p
                WHERE p.data->>'razorpay_order_id' = ? AND p.deleted_at IS NULL) AS recorded,
       EXISTS (SELECT 1 FROM payment_session ps
                WHERE ps.data->>'razorpay_order_id' = ? AND ps.deleted_at IS NULL) AS live_session,
       EXISTS (SELECT 1 FROM cart c
                WHERE c.id = ? AND c.completed_at IS NOT NULL) AS cart_completed`,
    [row.razorpay_order_id, row.razorpay_order_id, row.cart_id ?? ""],
  );
  const answer = (result.rows[0] ?? {}) as Record<string, unknown>;
  return {
    recorded: answer.recorded === true,
    liveSession: answer.live_session === true,
    cartCompleted: answer.cart_completed === true,
  };
}
