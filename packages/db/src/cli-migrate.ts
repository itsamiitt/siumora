import { connectionStringFromEnv, createPool } from "./client.ts";
import { migrate } from "./migrate.ts";

/** Apply migrations. Run against DATABASE_URL. */
const pool = createPool({
  connectionString: connectionStringFromEnv(),
  ssl: process.env.DATABASE_SSL === "true",
});

try {
  const applied = await migrate(pool);
  console.log(
    applied.length > 0
      ? `applied: ${applied.join(", ")}`
      : "already up to date",
  );
} finally {
  await pool.end();
}
