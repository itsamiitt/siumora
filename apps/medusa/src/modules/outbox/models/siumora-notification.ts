import { model } from "@medusajs/framework/utils";

/**
 * A customer message waiting to go, or gone (plan 16 Phase G) — the Medusa
 * twin of the Fastify `notifications` table, drained by apps/worker.
 *
 * One row per event per template (`event_key`, `template_key` unique): a
 * replayed courier webhook or a double-clicked status produces one message.
 * `variables` are stored so a retry renders the same words, and `recipient`
 * is where it was sent, not wherever the customer row points now.
 * `order_id` is Medusa's text id, deliberately not a foreign key.
 */
export const SiumoraNotification = model
  .define("siumora_notifications", {
    id: model.id({ prefix: "sintf" }).primaryKey(),
    event_key: model.text(),
    template_key: model.text(),
    category: model.text(),
    recipient: model.text(),
    order_id: model.text().nullable(),
    customer_id: model.text().nullable(),
    variables: model.json(),
    channel: model.text().nullable(),
    status: model.text().default("pending"),
    attempts: model.number().default(0),
    next_attempt_at: model.dateTime(),
    provider_message_id: model.text().nullable(),
    last_error: model.text().nullable(),
    sent_at: model.dateTime().nullable(),
  })
  .indexes([
    { on: ["event_key", "template_key"], unique: true },
    { on: ["recipient", "created_at"] },
  ]);
