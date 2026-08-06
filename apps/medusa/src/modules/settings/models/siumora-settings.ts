import { model } from "@medusajs/framework/utils";

/**
 * Runtime-changeable operational settings (design doc M2: "settings
 * (kill-switch + caps)") — the Medusa twin of the Fastify stack's `settings`
 * table (packages/db/src/schema.ts).
 *
 * The same deliberate shape: a dumb key/value store. The typed registry,
 * defaults and validation live in ../settings.ts, where they are testable —
 * the table never knows which keys exist. `key` is the primary key exactly
 * as it is on the Fastify side; `value` is jsonb.
 *
 * No seeded rows: defaults live in code (SETTING_DEFAULTS), so an empty
 * table already means "payments enabled, launch COD caps" — the same truth
 * an empty Fastify settings table tells.
 *
 * created_at/updated_at/deleted_at come with model.define.
 */
export const SiumoraSettings = model.define("siumora_settings", {
  key: model.text().primaryKey(),
  value: model.json(),
});
