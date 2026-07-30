import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createPool, migrate, seed } from "@siumora/db";

import { E2E_DATABASE_NAME, adminDatabaseUrl, e2eDatabaseUrl } from "./db-url.ts";

/**
 * A fresh database per run — dropped with FORCE so a crashed previous run's
 * lingering connections cannot wedge this one.
 *
 * The web build directory goes with it: catalog ids are baked into the
 * prerendered pages and the "use cache" store, and a cache from a previous
 * run's database serves variant ids the reseeded database has never heard of
 * — the storefront then says "Not found." to an Add-to-bag that did nothing
 * wrong.
 */

const webDist = fileURLToPath(new URL("../../web/.next-e2e", import.meta.url));
await rm(webDist, { recursive: true, force: true });

const admin = createPool({ connectionString: adminDatabaseUrl() });
try {
  await admin.query(`DROP DATABASE IF EXISTS ${E2E_DATABASE_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${E2E_DATABASE_NAME}`);
} finally {
  await admin.end();
}

const pool = createPool({ connectionString: e2eDatabaseUrl() });
try {
  await migrate(pool);
} finally {
  await pool.end();
}
await seed(e2eDatabaseUrl());

console.log(`[e2e] database ready: ${E2E_DATABASE_NAME}`);
