import type { SqlClient } from "./read";
import { readSettings } from "./read";
import { validateSettingWrite, type Settings } from "./settings";

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
