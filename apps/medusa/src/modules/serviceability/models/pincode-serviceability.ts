import { model } from "@medusajs/framework/utils";

/**
 * Pincode serviceability (design doc M2: the cod-rto/serviceability port).
 *
 * One row per pincode the courier has told us about, mirroring the Fastify
 * stack's pincode_serviceability table (packages/db/src/schema.ts) column
 * for column — same names, same defaults — so the two stacks answer the
 * same card for the same row. `pincode` is unique rather than the primary
 * key because model.define owns the id column; the routes only ever look
 * up by pincode (see lookup.ts).
 *
 * created_at/updated_at/deleted_at come with model.define.
 */
export const PincodeServiceability = model.define("siumora_pincode_serviceability", {
  id: model.id({ prefix: "sipin" }).primaryKey(),
  pincode: model.text().unique(),
  city: model.text().default(""),
  /** Two-digit GST state code — the place-of-supply signal. */
  state_code: model.text(),
  serviceable: model.boolean().default(true),
  cod_available: model.boolean().default(false),
  estimated_days: model.text().default("4–6"),
  /** Historical RTO rate in basis points — integer, so no float drift. */
  rto_rate_bps: model.number().default(0),
});
