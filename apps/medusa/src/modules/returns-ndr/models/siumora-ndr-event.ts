import { model } from "@medusajs/framework/utils";

/**
 * A failed delivery attempt (design doc M2 · returns-ndr) — the Fastify
 * ndr_events table as a module-owned table.
 *
 * One row per failed attempt, inserted by the status route when a courier
 * (or the simulation) reports NDR. `attempt` is 1-based, mirroring the
 * Fastify column; the module derives an order's delivery-attempt count from
 * these rows rather than keeping a second counter that could drift.
 * `action` is the customer's eventual answer (reattempt / update_address /
 * cancel), written by the NDR route once the answer is accepted.
 */
export const SiumoraNdrEvent = model.define("siumora_ndr_events", {
  id: model.id({ prefix: "sindr" }).primaryKey(),
  order_id: model.text(),
  reason: model.text(),
  attempt: model.number(),
  action: model.text().nullable(),
});
