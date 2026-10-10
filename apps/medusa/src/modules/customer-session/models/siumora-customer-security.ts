import { model } from "@medusajs/framework/utils";

/**
 * Per-customer security state an operator sets: blocked (with who and why)
 * and, after a merge, the customer this one was folded into. A row exists
 * only once an operator has acted; no row means "open".
 */
export const SiumoraCustomerSecurity = model.define("siumora_customer_security", {
  customer_id: model.text().primaryKey(),
  blocked_at: model.dateTime().nullable(),
  blocked_reason: model.text().nullable(),
  blocked_by: model.text().nullable(),
  merged_into: model.text().nullable(),
});
