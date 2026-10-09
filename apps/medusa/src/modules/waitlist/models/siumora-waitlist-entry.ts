import { model } from "@medusajs/framework/utils";

export const SiumoraWaitlistEntry = model.define("siumora_waitlist_entry", {
  id: model.id().primaryKey(),
  name: model.text(),
  email: model.text(),
});
