import { mergeSettings, type Settings } from "./settings";

/**
 * The settings read-path, in raw SQL against the shared pg connection
 * (ContainerRegistrationKeys.PG_CONNECTION — a knex client), the same
 * convention as siumora-order/allocate.ts. The generated module service is
 * not involved: the read is one SELECT over a four-row table, and the
 * defaults-merge (the part worth testing) is pure and lives in settings.ts.
 *
 * No deleted_at filter, deliberately: the Fastify readSettings reads every
 * row, nothing on either stack soft-deletes a setting, and a "deleted"
 * kill-switch row silently reverting to the default is exactly the kind of
 * quiet behavior a kill-switch must not have. The column exists only as
 * model.define housekeeping.
 */

/** Structural slice of knex so this file needs no knex type dependency. */
export interface SqlClient {
  raw(sql: string): Promise<{ rows: Array<{ key: string; value: unknown }> }>;
}

export async function readSettings(client: SqlClient): Promise<Settings> {
  const result = await client.raw("SELECT key, value FROM siumora_settings");
  return mergeSettings(result.rows);
}
