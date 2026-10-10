import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Hand-written and idempotent, like every module migration in this app (no
 * MikroORM snapshot — do not run `medusa db:generate` against this module;
 * write further migrations by hand here).
 */
export class Migration20261010090000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "siumora_customer_session" ("id" text not null, "customer_id" text not null, "auth_identity_id" text not null, "token_hash" text not null, "kind" text not null, "device" text null, "user_agent" text null, "ip" text null, "last_seen_at" timestamptz not null, "expires_at" timestamptz not null, "step_up_at" timestamptz null, "revoked_at" timestamptz null, "revoked_reason" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_customer_session_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_siumora_customer_session_token_hash" ON "siumora_customer_session" ("token_hash");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_customer_session_customer" ON "siumora_customer_session" ("customer_id") WHERE revoked_at IS NULL;`);

    this.addSql(`create table if not exists "siumora_customer_security" ("customer_id" text not null, "blocked_at" timestamptz null, "blocked_reason" text null, "blocked_by" text null, "merged_into" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_customer_security_pkey" primary key ("customer_id"));`);

    this.addSql(`create table if not exists "siumora_auth_event" ("id" text not null, "type" text not null, "customer_id" text null, "masked_phone" text null, "phone_key" text null, "channel" text null, "ip" text null, "device" text null, "detail" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_auth_event_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_auth_event_created_at" ON "siumora_auth_event" ("created_at");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_siumora_auth_event_customer" ON "siumora_auth_event" ("customer_id", "created_at");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "siumora_auth_event" cascade;`);
    this.addSql(`drop table if exists "siumora_customer_security" cascade;`);
    this.addSql(`drop table if exists "siumora_customer_session" cascade;`);
  }

}
