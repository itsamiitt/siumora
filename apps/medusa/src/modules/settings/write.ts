import type { SqlClient } from "./read";
import { readSettings } from "./read";
import { validateSettingBatch, validateSettingWrite, type Settings } from "./settings";

/**
 * The settings write path — the M2 ops-route twin of the Fastify
 * updateSetting (packages/db/src/settings-repository.ts): validate, upsert
 * the one row, read the merged result back. Raw SQL against the shared pg
 * connection, same as read.ts.
 */

/** A client that can also bind parameters (read.ts's slice is param-free). */
export interface WriteSqlClient extends SqlClient {
  raw(
    sql: string,
    bindings?: ReadonlyArray<string | number | boolean | null>,
  ): Promise<{ rows: Array<{ key: string; value: unknown }> }>;
}

export type UpdateResult =
  | { ok: true; settings: Settings }
  | { ok: false; error: string };

export async function updateSetting(
  client: WriteSqlClient,
  key: string,
  value: unknown,
): Promise<UpdateResult> {
  const validated = validateSettingWrite(key, value);
  if (!validated.ok) return validated;

  await client.raw(
    `INSERT INTO siumora_settings (key, value, created_at, updated_at)
     VALUES (?, ?::jsonb, now(), now())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = now()`,
    [validated.key, JSON.stringify(value)],
  );

  return { ok: true, settings: await readSettings(client) };
}

/**
 * Several settings in one statement (plan 16 B23) — one multi-row upsert,
 * so the save is atomic without a transaction handle: either every key in
 * a drawer's form lands, or none does.
 */
export async function updateSettings(
  client: WriteSqlClient,
  entries: unknown,
): Promise<UpdateResult & { keys?: string[] }> {
  const validated = validateSettingBatch(entries);
  if (!validated.ok) return validated;

  const rows = validated.entries.map(() => "(?, ?::jsonb, now(), now())").join(", ");
  const bindings = validated.entries.flatMap((entry) => [entry.key, JSON.stringify(entry.value)]);
  await client.raw(
    `INSERT INTO siumora_settings (key, value, created_at, updated_at)
     VALUES ${rows}
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = now()`,
    bindings,
  );
  return {
    ok: true,
    settings: await readSettings(client),
    keys: validated.entries.map((entry) => entry.key),
  };
}
