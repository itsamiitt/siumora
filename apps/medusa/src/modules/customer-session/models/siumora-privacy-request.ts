import { model } from "@medusajs/framework/utils";

/**
 * A data-principal request (DPDP Act): access, correction or erasure, with
 * the 30-day resolve-by core's slaFor sets. An erasure that cannot run yet
 * (a parcel still in transit needs its address) stays `acknowledged` with
 * the reason in `note` until an operator completes it.
 */
export const SiumoraPrivacyRequest = model.define("siumora_privacy_request", {
  id: model.id({ prefix: "sipr" }).primaryKey(),
  customer_id: model.text(),
  kind: model.text(),
  status: model.text(),
  note: model.text().nullable(),
  resolve_by: model.dateTime(),
  completed_at: model.dateTime().nullable(),
});
