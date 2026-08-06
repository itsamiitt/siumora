import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * The returns-ndr tables (design doc M2). Written in the same generated
 * style as the siumora-order migration, with the module's two hand-held
 * invariants added:
 *
 * - siumora_order_status.order_id is partial-unique (WHERE deleted_at IS
 *   NULL), and that index is the ON CONFLICT arbiter of the lazy status
 *   insert (data.ts ensureStatusRow) — concurrent first-touches converge on
 *   one row by construction.
 * - siumora_return_requests carries the one-open-per-order rule copied from
 *   the Fastify schema (packages/db/src/migrate.ts, returns_one_open_per_
 *   order): a partial UNIQUE index on order_id WHERE status <> 'rejected'.
 *   A second open return would refund the same piece twice; the database,
 *   not the application, refuses it. The extra `deleted_at IS NULL` arm is
 *   this module's soft-delete convention — a soft-deleted request must not
 *   block a fresh one.
 *
 * Everything is IF NOT EXISTS-guarded so a later regenerated migration (or
 * this one re-run against a database where a verification pass already
 * created the tables) converges instead of failing.
 */
export class Migration20260731140000 extends Migration {

  override async up(): Promise<void> {
    // ── The Siumora status machine state (see models/siumora-order-status).
    this.addSql(`create table if not exists "siumora_order_status" ("id" text not null, "order_id" text not null, "status" text not null, "ndr_reason" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_order_status_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_siumora_order_status_order_id_unique" ON "siumora_order_status" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_order_status_deleted_at" ON "siumora_order_status" ("deleted_at") WHERE deleted_at IS NULL;`);

    // ── Return requests, with the one-open-per-order partial unique index.
    this.addSql(`create table if not exists "siumora_return_requests" ("id" text not null, "order_id" text not null, "status" text not null, "reason" text not null, "resolution" text not null, "variant_ids" jsonb not null, "refund_to" text not null, "free_return_shipping" boolean not null default false, "seal_intact" boolean null, "note" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_return_requests_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_return_requests_order_id" ON "siumora_return_requests" ("order_id");`);
    // At most one open return per order; a second would refund the same
    // piece twice. Copied from packages/db/src/migrate.ts.
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_siumora_returns_one_open_per_order" ON "siumora_return_requests" ("order_id") WHERE status <> 'rejected' AND deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_return_requests_deleted_at" ON "siumora_return_requests" ("deleted_at") WHERE deleted_at IS NULL;`);

    // ── NDR events, one row per failed delivery attempt.
    this.addSql(`create table if not exists "siumora_ndr_events" ("id" text not null, "order_id" text not null, "reason" text not null, "attempt" integer not null, "action" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_ndr_events_pkey" primary key ("id"), constraint "siumora_ndr_attempt_positive" check (attempt > 0));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_ndr_events_order_id" ON "siumora_ndr_events" ("order_id");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_ndr_events_deleted_at" ON "siumora_ndr_events" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "siumora_ndr_events" cascade;`);
    this.addSql(`drop table if exists "siumora_return_requests" cascade;`);
    this.addSql(`drop table if exists "siumora_order_status" cascade;`);
  }

}
