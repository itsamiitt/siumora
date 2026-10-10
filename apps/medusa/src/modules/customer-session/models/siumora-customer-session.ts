import { model } from "@medusajs/framework/utils";

/**
 * One signed-in device (auth plan phase 1). The storefront holds the opaque
 * token; this row holds only its SHA-256 (token_hash), so reading the table
 * yields no usable session. See session.ts for the model.
 *
 * - `customer_id` / `auth_identity_id` — text references to Medusa-owned
 *   rows, not foreign keys (module convention).
 * - `kind` — customer (rolling 30 days) or operator (fixed 12 hours).
 * - `step_up_at` — when this session last passed an OTP; sensitive actions
 *   need it within STEP_UP_WINDOW_SECONDS.
 * - `revoked_at` / `revoked_reason` — sign-out never deletes, so the
 *   operator's security log can still show what happened.
 */
export const SiumoraCustomerSession = model.define("siumora_customer_session", {
  id: model.id({ prefix: "sises" }).primaryKey(),
  customer_id: model.text(),
  auth_identity_id: model.text(),
  token_hash: model.text().unique(),
  kind: model.text(),
  device: model.text().nullable(),
  user_agent: model.text().nullable(),
  ip: model.text().nullable(),
  last_seen_at: model.dateTime(),
  expires_at: model.dateTime(),
  step_up_at: model.dateTime().nullable(),
  revoked_at: model.dateTime().nullable(),
  revoked_reason: model.text().nullable(),
});
