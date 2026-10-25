import { model } from "@medusajs/framework/utils";

/**
 * A shopper's opt-in to one cart reminder (plan 16 B22, DPDP: consent for
 * this purpose, recorded with when it was given). One row per cart.
 *
 * - `status` — waiting (consented, not yet due), queued (the message went
 *   to the outbox), skipped (the cart was checked out or emptied, or the
 *   shopper withdrew). Never re-armed: one reminder per cart, ever.
 * - `phone` — the number to remind, normalised, as typed at step 1.
 */
export const SiumoraCartReminder = model.define("siumora_cart_reminders", {
  id: model.id({ prefix: "sicrm" }).primaryKey(),
  cart_id: model.text().unique(),
  phone: model.text(),
  consented_at: model.dateTime(),
  status: model.text().default("waiting"),
  reason: model.text().nullable(),
});
