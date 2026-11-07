/**
 * How an order was paid, from the payment Medusa recorded — not from the
 * order's metadata (security review, items 1 and 8).
 *
 * `metadata.siumora_payment_method` started on the cart, and a cart's
 * metadata is writable through Medusa's native store routes. Anything that
 * moves money or a parcel on the strength of "this order is prepaid" — the
 * courier's COD-vs-Prepaid booking, a refund to the instrument — asks which
 * provider holds the order's payment instead: Razorpay means the money was
 * taken online; the system provider (or no payment at all) means cash on
 * delivery. Metadata stays what the order card and invoice print (UPI vs
 * card), which the server stamps after its own checks.
 *
 * Pure plus one raw SQL read, so the Shiprocket provider (no query graph in
 * a module provider) and the store routes share it, and node --test pins it.
 */

/** Same ids as razorpay-payment/index.ts and lib/checkout-cart.ts — plain here, import-free. */
export const RAZORPAY_PROVIDER_ID = "pp_razorpay_razorpay";
export const SYSTEM_PROVIDER_ID = "pp_system_default";

export type SettlementKind = "prepaid" | "cod";

export interface OrderPaymentRow {
  id: string;
  provider_id: string;
  /** Major units, as Medusa stores them (numeric → string from pg). */
  amount: unknown;
  captured_at: string | Date | null;
  /** Sum of refunds already recorded against this payment, major units. */
  refunded?: unknown;
}

/**
 * Prepaid when any payment on the order is Razorpay's; cash on delivery
 * otherwise. No payment rows at all reads as COD — the courier collects,
 * the safe direction for the business (and the shape of an order placed
 * before payments were recorded).
 */
export function settlementOf(payments: ReadonlyArray<{ provider_id: string }>): SettlementKind {
  return payments.some((payment) => payment.provider_id === RAZORPAY_PROVIDER_ID) ? "prepaid" : "cod";
}

export interface RawClient {
  raw(sql: string, bindings?: ReadonlyArray<unknown>): Promise<{ rows: unknown[] }>;
}

/**
 * The order's payments, through the order ↔ payment-collection link table,
 * with what has been refunded off each.
 */
export async function orderPayments(pg: RawClient, orderId: string): Promise<OrderPaymentRow[]> {
  const result = await pg.raw(
    `SELECT p.id, p.provider_id, p.amount, p.captured_at,
            COALESCE((SELECT sum(r.amount) FROM refund r WHERE r.payment_id = p.id AND r.deleted_at IS NULL), 0) AS refunded
       FROM order_payment_collection opc
       JOIN payment p ON p.payment_collection_id = opc.payment_collection_id AND p.deleted_at IS NULL
      WHERE opc.order_id = ? AND opc.deleted_at IS NULL
      ORDER BY p.created_at ASC`,
    [orderId],
  );
  return result.rows as OrderPaymentRow[];
}

export async function orderSettlement(pg: RawClient, orderId: string): Promise<SettlementKind> {
  return settlementOf(await orderPayments(pg, orderId));
}
