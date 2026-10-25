import { execFileSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { MEDUSA_KEY_FILE } from "./backend.ts";
import { MEDUSA_E2E_DATABASE_NAME, medusaAdminDatabaseUrl, medusaE2eDatabaseUrl } from "./db-url.ts";

/**
 * A fresh Medusa database per run (plan 16 Phase J): dropped with FORCE,
 * migrated, seeded with the catalogue and the serviceability table, and its
 * publishable key handed to the harness — the same steps the CI `medusa`
 * job takes, so a green run here is the launch path, not a lookalike.
 */

const medusaDir = fileURLToPath(new URL("../../medusa", import.meta.url));
// pg is apps/medusa's dependency; resolved from there so this harness
// outlives packages/db (which goes with Fastify).
const { Pool } = createRequire(`${medusaDir}/package.json`)("pg") as {
  Pool: new (options: { connectionString: string }) => {
    query(sql: string): Promise<{ rows: unknown[] }>;
    end(): Promise<void>;
  };
};
const createPool = (options: { connectionString: string }) => new Pool(options);
const webDist = fileURLToPath(new URL("../../web/.next-e2e", import.meta.url));
await rm(webDist, { recursive: true, force: true });

const admin = createPool({ connectionString: medusaAdminDatabaseUrl() });
try {
  await admin.query(`DROP DATABASE IF EXISTS ${MEDUSA_E2E_DATABASE_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${MEDUSA_E2E_DATABASE_NAME}`);
} finally {
  await admin.end();
}

const env = { ...process.env, MEDUSA_DATABASE_URL: medusaE2eDatabaseUrl(), APP_ENV: "development" };
const run = (args: string[]) =>
  execFileSync("npx", args, { cwd: medusaDir, env, stdio: "inherit", shell: process.platform === "win32" });
run(["medusa", "db:migrate"]);
run(["medusa", "exec", "./src/scripts/seed.ts"]);
run(["medusa", "exec", "./src/scripts/seed-serviceability.ts"]);

const pool = createPool({ connectionString: medusaE2eDatabaseUrl() });
try {
  const result = await pool.query(
    "SELECT token FROM api_key WHERE type = 'publishable' AND revoked_at IS NULL ORDER BY created_at ASC LIMIT 1",
  );
  const publishableKey = (result.rows[0] as { token?: string } | undefined)?.token;
  if (!publishableKey) throw new Error("the Medusa seed made no publishable key");
  await writeFile(MEDUSA_KEY_FILE, JSON.stringify({ publishableKey }));
} finally {
  await pool.end();
}

console.log(`[e2e] medusa database ready: ${MEDUSA_E2E_DATABASE_NAME}`);
