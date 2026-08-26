import { model } from "@medusajs/framework/utils";

/**
 * The operator audit log — the Medusa twin of the Fastify stack's `audit_log`
 * table (packages/db/src/schema.ts), owned by this module so the M2 ops
 * routes have somewhere to testify.
 *
 * Same disposition as the Fastify table: full actor contact is stored for
 * accountability and MASKED at the read (parity row: "shows an operator the
 * log without the phone numbers") — masking at write would destroy the only
 * record of who acted. The route offers no way to change or delete an entry;
 * created_at/updated_at/deleted_at are model.define housekeeping, and nothing
 * soft-deletes an audit row.
 *
 * actor_contact rather than actor_phone: on this stack an actor is either a
 * phone-OTP customer on the ADMIN_PHONES list (phone) or an emailpass
 * dashboard user (email). The read envelope still serves `actorPhone`,
 * masked, because that is the field name the ops dashboard renders.
 */
export const SiumoraAudit = model.define("siumora_audit_log", {
  id: model.id({ prefix: "siaud" }).primaryKey(),
  actor_id: model.text().nullable(),
  actor_contact: model.text(),
  actor_role: model.text(),
  action: model.text(),
  subject: model.text().nullable(),
  detail: model.json().nullable(),
  ip: model.text().nullable(),
});
