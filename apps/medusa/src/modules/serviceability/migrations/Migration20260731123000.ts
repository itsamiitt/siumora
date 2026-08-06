import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260731123000 extends Migration {

  override async up(): Promise<void> {
    // The serviceability table, mirroring packages/db's
    // pincode_serviceability columns and defaults (schema.ts), plus the
    // model.define housekeeping columns. DDL twin: lookup.ts
    // ENSURE_TABLE_SQL carries these same statements so the exec seed can
    // stand the table up before the module is registered in
    // medusa-config.ts (owned elsewhere; REGISTER.md has the snippet) —
    // every statement is IF NOT EXISTS, so whichever runs first wins and
    // the other is a no-op. Evolve the two together.
    this.addSql(`create table if not exists "siumora_pincode_serviceability" ("id" text not null, "pincode" text not null, "city" text not null default '', "state_code" text not null, "serviceable" boolean not null default true, "cod_available" boolean not null default false, "estimated_days" text not null default '4–6', "rto_rate_bps" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_pincode_serviceability_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_siumora_pincode_serviceability_pincode_unique" ON "siumora_pincode_serviceability" ("pincode") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_pincode_serviceability_deleted_at" ON "siumora_pincode_serviceability" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "siumora_pincode_serviceability" cascade;`);
  }

}
