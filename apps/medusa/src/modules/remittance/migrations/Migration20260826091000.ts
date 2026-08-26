import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Hand-written and idempotent, like every module migration in this app (no
 * MikroORM snapshot exists — write migrations by hand here, never
 * db:generate).
 *
 * The unique index on (batch_id, order_number) is the idempotency guarantee:
 * re-uploading a file must not book the money twice, and couriers resend
 * files routinely — the second write is absorbed, the outcomes come back
 * unchanged (same index the Fastify cod_remittances table carries).
 */
export class Migration20260826091000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "siumora_cod_remittances" ("id" text not null, "batch_id" text not null, "courier" text not null, "order_number" text not null, "order_id" text null, "collected" integer not null, "deductions" integer not null default 0, "remitted" integer not null, "declared_weight_grams" integer null, "charged_weight_grams" integer null, "outcome" text not null, "variance" integer not null default 0, "note" text null, "remitted_on" timestamptz null, "reconciled_at" timestamptz not null default now(), "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_cod_remittances_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_siumora_cod_remittance_batch_order" ON "siumora_cod_remittances" ("batch_id", "order_number");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_cod_remittance_order" ON "siumora_cod_remittances" ("order_number");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_cod_remittances_deleted_at" ON "siumora_cod_remittances" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "siumora_cod_remittances" cascade;`);
  }

}
