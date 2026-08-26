import { model } from "@medusajs/framework/utils";

/**
 * COD remittance ledger — the Medusa twin of the Fastify `cod_remittances`
 * table (packages/db/src/schema.ts). One row per (batch, order) claim in a
 * courier's remittance file, with the reconciler's verdict written beside
 * what was claimed.
 *
 * order_number is text and unfiltered on purpose: a file may name an order
 * this shop never sold, and that row must be storable to be flagged.
 * order_id is a FK-less text reference (design doc: shared-schema tables
 * hold text refs, never cross-module FKs).
 *
 * All money integer paise; weights in grams, null when the file carried no
 * weights (which is not the same as zero).
 */
export const SiumoraCodRemittance = model.define("siumora_cod_remittances", {
  id: model.id({ prefix: "sirem" }).primaryKey(),
  batch_id: model.text(),
  courier: model.text(),
  order_number: model.text(),
  order_id: model.text().nullable(),
  collected: model.number(),
  deductions: model.number().default(0),
  remitted: model.number(),
  declared_weight_grams: model.number().nullable(),
  charged_weight_grams: model.number().nullable(),
  outcome: model.text(),
  variance: model.number().default(0),
  note: model.text().nullable(),
  remitted_on: model.dateTime().nullable(),
  reconciled_at: model.dateTime(),
});
