import { model } from "@medusajs/framework/utils";

/**
 * The customer auth event log — every code requested, sent, failed and
 * verified, every sign-in, sign-out and revocation. Feeds the admin's
 * sign-in health and abuse views and each customer's security log.
 *
 * No raw phone numbers: `masked_phone` for display, `phone_key` (a keyed
 * HMAC, session.ts phoneKey) for grouping. `ip` is coarse (/24, /48).
 * Operator actions go to the audit module instead; this log is about
 * customers.
 */
export const SiumoraAuthEvent = model.define("siumora_auth_event", {
  id: model.id({ prefix: "siaev" }).primaryKey(),
  type: model.text(),
  customer_id: model.text().nullable(),
  masked_phone: model.text().nullable(),
  phone_key: model.text().nullable(),
  channel: model.text().nullable(),
  ip: model.text().nullable(),
  device: model.text().nullable(),
  detail: model.json().nullable(),
});
