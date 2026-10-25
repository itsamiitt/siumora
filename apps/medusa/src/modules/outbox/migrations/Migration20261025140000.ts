import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * The outbox tables (plan 16 Phase G) — see models/. The two unique keys
 * are the dedup the whole design rests on: one message per event per
 * template, one conversion per event per destination. The drain indexes
 * (status + next_attempt_at) keep apps/worker's claim cheap. IF NOT
 * EXISTS-guarded so a re-run converges.
 */
export class Migration20261025140000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "siumora_notifications" ("id" text not null, "event_key" text not null, "template_key" text not null, "category" text not null, "recipient" text not null, "order_id" text null, "customer_id" text null, "variables" jsonb not null default '{}', "channel" text null, "status" text not null default 'pending', "attempts" integer not null default 0, "next_attempt_at" timestamptz not null default now(), "provider_message_id" text null, "last_error" text null, "sent_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_notifications_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_siumora_notifications_event_template" ON "siumora_notifications" ("event_key", "template_key");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_notifications_recipient" ON "siumora_notifications" ("recipient", "created_at");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_notifications_due" ON "siumora_notifications" ("status", "next_attempt_at");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_notifications_provider_message" ON "siumora_notifications" ("provider_message_id") WHERE provider_message_id IS NOT NULL;`);

    this.addSql(`create table if not exists "siumora_tracking_events" ("id" text not null, "event_id" text not null, "event_name" text not null, "order_id" text null, "destination" text not null, "status" text not null default 'pending', "attempts" integer not null default 0, "payload" jsonb null, "sent_at" timestamptz null, "next_attempt_at" timestamptz not null default now(), "last_error" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_tracking_events_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_siumora_tracking_events_event_destination" ON "siumora_tracking_events" ("event_id", "destination");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_tracking_events_due" ON "siumora_tracking_events" ("status", "next_attempt_at");`);

    this.addSql(`create table if not exists "siumora_notification_preferences" ("id" text not null, "recipient" text not null, "marketing_consent" boolean not null default false, "opted_out" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_notification_preferences_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_siumora_notification_preferences_recipient" ON "siumora_notification_preferences" ("recipient");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "siumora_notification_preferences" cascade;`);
    this.addSql(`drop table if exists "siumora_tracking_events" cascade;`);
    this.addSql(`drop table if exists "siumora_notifications" cascade;`);
  }
}
