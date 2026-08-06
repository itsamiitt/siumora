import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Hand-written (idempotent, like the siumora-order migration): the module is
 * complete before it is registered in medusa-config.ts, so this file could
 * not come from `medusa db:generate`. Consequently there is no MikroORM
 * snapshot for this module — do not run db:generate against it, or it will
 * propose this table a second time; write migrations by hand here instead.
 *
 * No seed rows, deliberately. Defaults (payments enabled, launch COD caps)
 * live in code — src/modules/settings/settings.ts SETTING_DEFAULTS, the same
 * split the Fastify stack uses (packages/db/src/settings-repository.ts): an
 * empty table IS the default configuration, and a row only exists once an
 * operator has moved a lever.
 */
export class Migration20260731150000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "siumora_settings" ("key" text not null, "value" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_settings_pkey" primary key ("key"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_settings_deleted_at" ON "siumora_settings" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "siumora_settings" cascade;`);
  }

}
