import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * siumora_razorpay_orders (security review, item 2) — see
 * models/siumora-razorpay-order.ts. Hand-written and idempotent. The recon
 * sweep reads open rows by age.
 */
export class Migration20261107090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "siumora_razorpay_orders" ("id" text not null, "razorpay_order_id" text not null, "cart_id" text null, "session_id" text null, "amount_paise" integer not null, "status" text not null default 'open', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_razorpay_orders_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_siumora_razorpay_orders_razorpay_order_id_unique" ON "siumora_razorpay_orders" ("razorpay_order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_razorpay_orders_open" ON "siumora_razorpay_orders" ("status", "created_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_razorpay_orders_cart_id" ON "siumora_razorpay_orders" ("cart_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "siumora_razorpay_orders" cascade;`);
  }
}
