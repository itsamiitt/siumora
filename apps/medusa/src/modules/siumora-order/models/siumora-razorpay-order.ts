import { model } from "@medusajs/framework/utils";

/**
 * One row per Razorpay order the provider ever created (security review,
 * item 2) — the ledger the recon sweep walks so money paid against a
 * superseded Razorpay order is found and refunded. See razorpay-ledger.ts.
 *
 * - `razorpay_order_id` — unique; the Razorpay order.
 * - `cart_id` / `session_id` — what it was opened for (text references, not
 *   foreign keys: module convention). cart_id is stamped by the prepare route.
 * - `amount_paise` — what the order was for.
 * - `status` — open, completed (a Medusa payment records it), refunded,
 *   refund_failed (retried next sweep, alerted), expired (never paid).
 */
export const SiumoraRazorpayOrder = model.define("siumora_razorpay_orders", {
  id: model.id({ prefix: "sirzo" }).primaryKey(),
  razorpay_order_id: model.text().unique(),
  cart_id: model.text().nullable(),
  session_id: model.text().nullable(),
  amount_paise: model.number(),
  status: model.text().default("open"),
});
