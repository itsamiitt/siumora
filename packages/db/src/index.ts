/**
 * Data layer.
 *
 * Query helpers are re-exported so callers depend on this package rather than
 * reaching past it into drizzle directly — the ORM stays swappable and the
 * boundary stays one import deep.
 */
export { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";

export {
  connectionStringFromEnv,
  createDb,
  createPool,
  schema,
  type Database,
  type DbConfig,
} from "./client.ts";

export * from "./schema.ts";
export { migrate, MIGRATIONS } from "./migrate.ts";
export * from "./repositories.ts";
export { createTestDatabase, type TestDatabase } from "./testing.ts";
