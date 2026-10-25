import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Plan 16 Phase H (B28, B29): the once-only markers.
 *
 * - siumora_return_requests.payout_reference / payout_recorded_at — the
 *   manual COD payout's UPI/UTR reference. Its presence is the idempotency
 *   guard (one parcel, one payout), as on the Fastify return_requests.
 * - siumora_order_status.restocked_at — the goods of an rto/returned order
 *   went back on the shelf. A separate column, never updated_at: updated_at
 *   doubles as the delivered-at timestamp (models/siumora-order-status.ts).
 *
 * ADD COLUMN IF NOT EXISTS, like the module's other hand-guarded migrations.
 */
export class Migration20261025150000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "siumora_return_requests" add column if not exists "payout_reference" text null, add column if not exists "payout_recorded_at" timestamptz null;`);
    this.addSql(`alter table if exists "siumora_order_status" add column if not exists "restocked_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "siumora_return_requests" drop column if exists "payout_reference", drop column if exists "payout_recorded_at";`);
    this.addSql(`alter table if exists "siumora_order_status" drop column if exists "restocked_at";`);
  }
}
