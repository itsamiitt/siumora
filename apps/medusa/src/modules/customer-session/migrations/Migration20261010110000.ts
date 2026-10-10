import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Data-principal requests (auth plan phase 2 account → Privacy; the Medusa
 * twin of the Fastify privacy_requests table). Hand-written, idempotent.
 */
export class Migration20261010110000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "siumora_privacy_request" ("id" text not null, "customer_id" text not null, "kind" text not null, "status" text not null, "note" text null, "resolve_by" timestamptz not null, "completed_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_privacy_request_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_privacy_request_open" ON "siumora_privacy_request" ("customer_id", "kind") WHERE status IN ('received', 'acknowledged');`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "siumora_privacy_request" cascade;`);
  }

}
