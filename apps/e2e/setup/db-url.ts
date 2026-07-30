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
