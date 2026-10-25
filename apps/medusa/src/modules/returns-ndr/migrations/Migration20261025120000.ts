import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * siumora_shipments (plan 16 Phase F): the courier booking per order — see
 * models/siumora-shipment.ts. order_id is partial-unique (one live booking),
 * awb indexed for the courier webhook's lookup. IF NOT EXISTS-guarded, like
 * the module's first migration.
 */
export class Migration20261025120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "siumora_shipments" ("id" text not null, "order_id" text not null, "courier_order_id" text null, "shipment_id" text null, "awb" text null, "courier" text null, "pickup_scheduled" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_shipments_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_siumora_shipments_order_id_unique" ON "siumora_shipments" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_shipments_awb" ON "siumora_shipments" ("awb") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_shipments_deleted_at" ON "siumora_shipments" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "siumora_shipments" cascade;`);
  }
}
