import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261009090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "siumora_waitlist_entry" ("id" text not null, "name" text not null, "email" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_waitlist_entry_pkey" primary key ("id"), constraint "siumora_waitlist_name_length" check (char_length(name) between 1 and 100), constraint "siumora_waitlist_email_length" check (char_length(email) <= 254));`);
    this.addSql(`create unique index if not exists "siumora_waitlist_email_key" on "siumora_waitlist_entry" (email);`);
    this.addSql(`create index if not exists "siumora_waitlist_created_idx" on "siumora_waitlist_entry" (created_at desc, id desc);`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "siumora_waitlist_entry" cascade;`);
  }
}
