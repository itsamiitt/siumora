import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema.ts";

/**
 * Database client.
 *
 * A pool, not a connection: serverless handlers open and close constantly, and
 * a single connection would serialise every request behind one socket.
 */

export type Database = NodePgDatabase<typeof schema>;

/**
 * Postgres returns `bigint` and `numeric` as strings to avoid silent precision
 * loss. Money is stored as `integer` paise precisely so it never takes that
 * path, but `count(*)` comes back as bigint — parse it so callers get a number
 * rather than a string that compares wrong.
 */
pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10));

export interface DbConfig {
  connectionString: string;
  /** Managed Postgres almost always requires TLS; local sockets never do. */
  ssl?: boolean;
  max?: number;
}

export function createPool(config: DbConfig): pg.Pool {
  return new pg.Pool({
    connectionString: config.connectionString,
    ...(config.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
    max: config.max ?? 10,
    // Fail fast rather than hanging a request behind an unreachable database.
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
  });
}

export function createDb(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}

/**
 * Resolve the connection string.
 *
 * Throws rather than defaulting to localhost: a production process that
 * silently connects to a database that is not there fails much later and much
 * more confusingly than one that refuses to start.
 */
export function connectionStringFromEnv(env = process.env): string {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Point it at Postgres before starting.",
    );
  }
  return url;
}

export { schema };
