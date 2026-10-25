import { model } from "@medusajs/framework/utils";

/**
 * Who has asked not to be messaged (plan 16 Phase G). Keyed on the number,
 * not the customer: a guest can opt out too, and the wish outlives the order.
 * `opted_out` stops everything, utility included — it is a person asking.
 */
export const SiumoraNotificationPreference = model.define("siumora_notification_preferences", {
  id: model.id({ prefix: "sinpr" }).primaryKey(),
  recipient: model.text().unique(),
  marketing_consent: model.boolean().default(false),
  opted_out: model.boolean().default(false),
});
