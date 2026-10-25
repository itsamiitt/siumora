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

// ── The admin's view (plan 16 B25) ────────────────────────────────────────

export interface ServiceabilitySummary {
  total: number;
  serviceable: number;
  codAvailable: number;
  updatedAt: string | null;
}

export async function summariseServiceability(client: SqlClient): Promise<ServiceabilitySummary> {
  const result = await client.raw(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE serviceable)::int AS serviceable,
            count(*) FILTER (WHERE serviceable AND cod_available)::int AS cod_available,
            max(updated_at) AS updated_at
       FROM siumora_pincode_serviceability WHERE deleted_at IS NULL`,
  );
  const row = (result.rows[0] ?? {}) as Record<string, unknown>;
  const updated = row.updated_at;
  return {
    total: Number(row.total ?? 0),
    serviceable: Number(row.serviceable ?? 0),
    codAvailable: Number(row.cod_available ?? 0),
    updatedAt: updated instanceof Date ? updated.toISOString() : typeof updated === "string" ? updated : null,
  };
}

const IMPORT_CHUNK = 500;

/**
 * Upsert a checked courier file. `dryRun` reports what would change and
 * writes nothing — the owner sees "1,240 new, 36 changed" before committing.
 * Rows not in the file are left alone: a partial file never unserves the
 * rest of India.
 */
export async function importServiceability(
  client: SqlClient,
  rows: ReadonlyArray<{
    pincode: string;
    city: string;
    state_code: string;
    serviceable: boolean;
    cod_available: boolean;
    estimated_days: string;
    rto_rate_bps: number;
  }>,
  options: { dryRun: boolean },
): Promise<{ added: number; updated: number; unchanged: number }> {
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (let start = 0; start < rows.length; start += IMPORT_CHUNK) {
    const chunk = rows.slice(start, start + IMPORT_CHUNK);
    const existing = await client.raw(
      `SELECT ${COLUMNS} FROM siumora_pincode_serviceability
        WHERE deleted_at IS NULL AND pincode IN (${chunk.map(() => "?").join(", ")})`,
      chunk.map((row) => row.pincode),
    );
    const known = new Map(
      (existing.rows as unknown as PincodeRow[]).map((row) => [row.pincode, row]),
    );
    for (const row of chunk) {
      const current = known.get(row.pincode);
      if (!current) added += 1;
      else if (
        current.city === row.city &&
        current.state_code === row.state_code &&
        current.serviceable === row.serviceable &&
        current.cod_available === row.cod_available &&
        current.estimated_days === row.estimated_days &&
        current.rto_rate_bps === row.rto_rate_bps
      ) unchanged += 1;
      else updated += 1;
    }
    if (options.dryRun) continue;

    await client.raw(
      `INSERT INTO siumora_pincode_serviceability
         (id, pincode, city, state_code, serviceable, cod_available, estimated_days, rto_rate_bps, created_at, updated_at)
       VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, now(), now())").join(", ")}
       ON CONFLICT (pincode) WHERE deleted_at IS NULL
       DO UPDATE SET
         city = excluded.city,
         state_code = excluded.state_code,
         serviceable = excluded.serviceable,
         cod_available = excluded.cod_available,
         estimated_days = excluded.estimated_days,
         rto_rate_bps = excluded.rto_rate_bps,
         updated_at = now()`,
      chunk.flatMap((row) => [
        `sipin_${randomUUID().replaceAll("-", "")}`,
        row.pincode,
        row.city,
        row.state_code,
        row.serviceable,
        row.cod_available,
        row.estimated_days,
        row.rto_rate_bps,
      ]),
    );
  }
  return { added, updated, unchanged };
}
