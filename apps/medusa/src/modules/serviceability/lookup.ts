import { randomUUID } from "node:crypto";

import { PINCODES } from "./pincodes.ts";
import type { PincodeRow } from "./serviceability.ts";

/**
 * The serviceability read-path and seed, in raw SQL against the shared pg
 * connection (ContainerRegistrationKeys.PG_CONNECTION — a knex client), the
 * same convention as siumora-order/allocate.ts and settings/read.ts. Both
 * routes (the pincode card and the checkout quote) read through findPincode,
 * so there is exactly one lookup to keep honest.
 */

/** Structural slice of knex so this file needs no knex type dependency. */
export interface SqlClient {
  raw(
    sql: string,
    bindings?: ReadonlyArray<string | number | boolean>,
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}

const COLUMNS =
  "pincode, city, state_code, serviceable, cod_available, estimated_days, rto_rate_bps";

export async function findPincode(
  client: SqlClient,
  pincode: string,
): Promise<PincodeRow | undefined> {
  const result = await client.raw(
    `SELECT ${COLUMNS} FROM siumora_pincode_serviceability WHERE pincode = ? AND deleted_at IS NULL`,
    [pincode],
  );
  return result.rows[0] as unknown as PincodeRow | undefined;
}

/**
 * DDL twin of migrations/Migration20260731123000.ts — evolve together.
 *
 * The migration is the owner of this DDL once the module is registered in
 * medusa-config.ts (REGISTER.md; the config file is owned elsewhere) and
 * `medusa db:migrate` runs it. Until then the seed below ensures the table
 * so the routes can serve; every statement is IF NOT EXISTS, so whichever
 * of the two runs first wins and the other is a no-op.
 */
const ENSURE_TABLE_SQL: readonly string[] = [
  `create table if not exists "siumora_pincode_serviceability" ("id" text not null, "pincode" text not null, "city" text not null default '', "state_code" text not null, "serviceable" boolean not null default true, "cod_available" boolean not null default false, "estimated_days" text not null default '4–6', "rto_rate_bps" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "siumora_pincode_serviceability_pkey" primary key ("id"));`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_siumora_pincode_serviceability_pincode_unique" ON "siumora_pincode_serviceability" ("pincode") WHERE deleted_at IS NULL;`,
  `CREATE INDEX IF NOT EXISTS "IDX_siumora_pincode_serviceability_deleted_at" ON "siumora_pincode_serviceability" ("deleted_at") WHERE deleted_at IS NULL;`,
];

/**
 * Idempotent — convergent, in the main seed's sense: re-running converges
 * the five canonical rows (pincodes.ts) to their canonical values, including
 * `serviceable = true`, the table default the source rows rely on. Rows NOT
 * in the canonical list are left alone (the Fastify seed wipes the table;
 * here, as in scripts/seed.ts, hand-added rows survive — a courier update
 * entered by an operator is data, not drift).
 */
export async function seedServiceability(
  client: SqlClient,
): Promise<{ pincodes: number }> {
  for (const sql of ENSURE_TABLE_SQL) {
    await client.raw(sql);
  }

  for (const row of PINCODES) {
    const id = `sipin_${randomUUID().replaceAll("-", "")}`;
    await client.raw(
      `INSERT INTO siumora_pincode_serviceability
         (id, pincode, city, state_code, serviceable, cod_available, estimated_days, rto_rate_bps, created_at, updated_at)
       VALUES (?, ?, ?, ?, true, ?, ?, ?, now(), now())
       ON CONFLICT (pincode) WHERE deleted_at IS NULL
       DO UPDATE SET
         city = excluded.city,
         state_code = excluded.state_code,
         serviceable = true,
         cod_available = excluded.cod_available,
         estimated_days = excluded.estimated_days,
         rto_rate_bps = excluded.rto_rate_bps,
         updated_at = now()`,
      [
        id,
        row.pincode,
        row.city,
        row.stateCode,
        row.codAvailable,
        row.estimatedDays,
        row.rtoRateBps,
      ],
    );
  }

  return { pincodes: PINCODES.length };
}
