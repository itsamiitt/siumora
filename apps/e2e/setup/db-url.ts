/**
 * One database for the whole E2E run, derived from the same DATABASE_URL the
 * rest of the repo uses — the suite must never touch the development data.
 */

export const E2E_DATABASE_NAME = "siumora_e2e";

export function adminDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set — the E2E suite needs a Postgres server.");
  }
  return url;
}

export function e2eDatabaseUrl(): string {
  const admin = new URL(adminDatabaseUrl());
  admin.pathname = `/${E2E_DATABASE_NAME}`;
  return admin.toString();
}

/** The Medusa backend's E2E database (plan 16 Phase J), on the same server. */
export const MEDUSA_E2E_DATABASE_NAME = "siumora_medusa_e2e";

/**
 * The Postgres server to make it on: MEDUSA_DATABASE_URL when the machine
 * runs Medusa only, else DATABASE_URL. Only the server is used — the suite
 * never touches the database either URL names.
 */
export function medusaAdminDatabaseUrl(): string {
  const url = process.env.MEDUSA_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("MEDUSA_DATABASE_URL (or DATABASE_URL) is not set — the E2E suite needs a Postgres server.");
  }
  return url;
}

export function medusaE2eDatabaseUrl(): string {
  const admin = new URL(medusaAdminDatabaseUrl());
  admin.pathname = `/${MEDUSA_E2E_DATABASE_NAME}`;
  return admin.toString();
}
