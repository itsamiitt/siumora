import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260731101524 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "siumora_order_identity" drop constraint if exists "siumora_order_identity_idempotency_key_unique";`);
    this.addSql(`alter table if exists "siumora_order_identity" drop constraint if exists "siumora_order_identity_order_number_unique";`);
    this.addSql(`alter table if exists "siumora_order_identity" drop constraint if exists "siumora_order_identity_order_id_unique";`);
    this.addSql(`create table if not exists "siumora_order_identity" ("id" text not null, "order_id" text not null, "cart_id" text null, "order_number" text not null, "access_key" text not null, "idempotency_key" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_order_identity_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_siumora_order_identity_order_id_unique" ON "siumora_order_identity" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_siumora_order_identity_order_number_unique" ON "siumora_order_identity" ("order_number") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_siumora_order_identity_idempotency_key_unique" ON "siumora_order_identity" ("idempotency_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_order_identity_deleted_at" ON "siumora_order_identity" ("deleted_at") WHERE deleted_at IS NULL;`);
    // Allocation-under-concurrency disposition (hand-added to the generated
    // migration): SIU order numbers are drawn from this Postgres sequence
    // inside the identity INSERT itself ('SIU-' || lpad(nextval(...))).
    // nextval is atomic — two concurrent transactions can never draw the same
    // value, so the database, not the application, enforces no-double-issue.
    // CACHE 1 (the default, stated explicitly) keeps draws strictly
    // monotonic across connections, which is what makes "the next order gets
    // a strictly later number" true. A draw whose transaction rolls back
    // leaves a gap; that is deliberate and fine — order numbers owe
    // uniqueness and order, not gaplessness. The gapless statutory series is
    // the GST invoice number, which belongs to the M2 gst module and its
    // same-table allocation lock, not to this sequence.
    this.addSql(`CREATE SEQUENCE IF NOT EXISTS "siumora_order_number_seq" AS bigint START WITH 1 INCREMENT BY 1 CACHE 1;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop sequence if exists "siumora_order_number_seq";`);
    this.addSql(`drop table if exists "siumora_order_identity" cascade;`);
  }

}
