import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Hand-written and idempotent, like every module migration in this app (the
 * module is complete before it is registered in medusa-config.ts, so this
 * file could not come from `medusa db:generate` — and there is no MikroORM
 * snapshot for it; write migrations by hand here).
 *
 * The table mirrors the Fastify audit_log (packages/db/src/schema.ts): the
 * full actor contact is stored, reads mask it. No unique constraints — an
 * audit log records what happened, however often it happened.
 */
export class Migration20260826090000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "siumora_audit_log" ("id" text not null, "actor_id" text null, "actor_contact" text not null, "actor_role" text not null, "action" text not null, "subject" text null, "detail" jsonb null, "ip" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_audit_log_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_audit_log_created_at" ON "siumora_audit_log" ("created_at");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_audit_log_action" ON "siumora_audit_log" ("action");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_audit_log_deleted_at" ON "siumora_audit_log" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "siumora_audit_log" cascade;`);
  }

}
