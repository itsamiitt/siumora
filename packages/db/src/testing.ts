import pg from "pg";

/**
 * Per-suite test databases.
 *
 * Turborepo runs package tasks in parallel, so two suites pointed at one
 * database delete each other's rows mid-test and fail in ways that look like
 * real bugs. Each suite gets its own database instead, created on demand from
 * the server in DATABASE_URL.
 *
 * Isolating by database rather than by transaction is deliberate: the
 * concurrency tests need two connections committing against each other, which
 * a shared rollback-per-test transaction would make impossible to express.
 */

export interface TestDatabase {
  url: string;
  drop: () => Promise<void>;
}

/** Only lowercase letters, digits and underscores — never interpolated blind. */
function safeName(suite: string): string {
  const cleaned = suite.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!cleaned) throw new Error("suite name produced an empty database name");
  return `siumora_test_${cleaned}`;
}

/**
 * Provision a database for one suite and return its URL.
 *
 * Returns undefined when DATABASE_URL is unset, so suites can skip rather than
 * fail on a machine with no Postgres.
 */
export async function createTestDatabase(
  suite: string,
  baseUrl = process.env.DATABASE_URL,
): Promise<TestDatabase | undefined> {
  if (!baseUrl) return undefined;

  const name = safeName(suite);
  const admin = new pg.Pool({ connectionString: baseUrl, max: 1 });

  try {
    // CREATE DATABASE cannot run inside a transaction and has no IF NOT
    // EXISTS, so check first and tolerate the race with another runner.
    const existing = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [name],
    );
    if (existing.rowCount === 0) {
      try {
        await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
      } catch (error) {
        // 42P04 is duplicate_database — another runner won, which is fine.
        if ((error as { code?: string }).code !== "42P04") throw error;
      }
    }
  } finally {
    await admin.end();
  }

  const url = new URL(baseUrl);
  url.pathname = `/${name}`;

  return {
    url: url.toString(),
    drop: async () => {
      const cleanup = new pg.Pool({ connectionString: baseUrl, max: 1 });
      try {
        await cleanup.query(
          `DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`,
        );
      } finally {
        await cleanup.end();
      }
    },
  };
}
