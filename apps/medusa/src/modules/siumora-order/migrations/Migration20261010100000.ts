import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Order ownership (auth plan phase 2), hand-written and idempotent.
 *
 * `customer_id` is the account that owns the order: set at checkout when the
 * shopper was signed in, or when a signed-in customer confirms a guest order
 * placed on their phone ("Is this your order?"). `claimed_at` records the
 * latter. Text references, not foreign keys (module convention).
 */
export class Migration20261010100000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "siumora_order_identity" add column if not exists "customer_id" text null;`);
    this.addSql(`alter table if exists "siumora_order_identity" add column if not exists "claimed_at" timestamptz null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_order_identity_customer_id" ON "siumora_order_identity" ("customer_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_siumora_order_identity_customer_id";`);
    this.addSql(`alter table if exists "siumora_order_identity" drop column if exists "claimed_at";`);
    this.addSql(`alter table if exists "siumora_order_identity" drop column if exists "customer_id";`);
  }

}
