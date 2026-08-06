import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Hand-written (idempotent, like the siumora-order migration): the module is
 * complete before it is registered in medusa-config.ts, so this file could
 * not come from `medusa db:generate`. Consequently there is no MikroORM
 * snapshot for this module — do not run db:generate against it, or it will
 * propose this table a second time; write migrations by hand here instead.
 *
 * wishlist_id is a real uuid column (the routes validate the shape before it
 * binds), and the composite primary key is both the "a piece is on a list
 * once" invariant and the arbiter the toggle's ON CONFLICT insert leans on.
 */
export class Migration20260731150100 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "siumora_wishlists" ("wishlist_id" uuid not null, "handle" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_wishlists_pkey" primary key ("wishlist_id", "handle"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_wishlists_deleted_at" ON "siumora_wishlists" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "siumora_wishlists" cascade;`);
  }

}
