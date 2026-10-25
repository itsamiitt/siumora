import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * siumora_cart_reminders (plan 16 B22) — see models/siumora-cart-reminder.ts.
 * The due-reminder sweep reads waiting rows by consent time.
 */
export class Migration20261026100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "siumora_cart_reminders" ("id" text not null, "cart_id" text not null, "phone" text not null, "consented_at" timestamptz not null, "status" text not null default 'waiting', "reason" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_cart_reminders_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_siumora_cart_reminders_cart_id_unique" ON "siumora_cart_reminders" ("cart_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_cart_reminders_due" ON "siumora_cart_reminders" ("status", "consented_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "siumora_cart_reminders" cascade;`);
  }
}
