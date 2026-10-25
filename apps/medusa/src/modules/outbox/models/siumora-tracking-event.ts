import { model } from "@medusajs/framework/utils";

/**
 * A server-side conversion waiting to be posted to GA4 or Meta (plan 16
 * Phase G) — the Medusa twin of the Fastify `tracking_events` ledger,
 * drained by apps/worker. One send per event per destination
 * (`event_id`, `destination` unique): the browser pixel and this row share
 * the checkout's event id, so the two dedupe into one conversion.
 */
export const SiumoraTrackingEvent = model
  .define("siumora_tracking_events", {
    id: model.id({ prefix: "sitev" }).primaryKey(),
    event_id: model.text(),
    event_name: model.text(),
    order_id: model.text().nullable(),
    destination: model.text(),
    status: model.text().default("pending"),
    attempts: model.number().default(0),
    payload: model.json().nullable(),
    sent_at: model.dateTime().nullable(),
    next_attempt_at: model.dateTime(),
    last_error: model.text().nullable(),
  })
  .indexes([{ on: ["event_id", "destination"], unique: true }]);
