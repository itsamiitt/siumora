/**
 * Boot guards, pure — the Medusa port of the Fastify assertBootSafety
 * contract (parity checklist: "API lib — boot guards"). The config loader
 * calls this before defineConfig; tests exercise it without booting anything.
 *
 * APP_ENV, not NODE_ENV, gates behavior: managed staging runs
 * NODE_ENV=production, so NODE_ENV cannot tell staging from production.
 */

export const DEV_SECRET = "supersecret-dev-only";

export type AppEnv = "development" | "staging" | "production";

export interface MedusaBootEnv {
  APP_ENV?: string;
  JWT_SECRET?: string;
  COOKIE_SECRET?: string;
  MEDUSA_DATABASE_URL?: string;
}

export function resolveAppEnv(env: MedusaBootEnv): AppEnv {
  const appEnv = env.APP_ENV ?? "development";
  if (appEnv !== "development" && appEnv !== "staging" && appEnv !== "production") {
    throw new Error(`APP_ENV must be development|staging|production, got "${appEnv}"`);
  }
  return appEnv;
}

export function assertMedusaBootSafety(env: MedusaBootEnv): {
  appEnv: AppEnv;
  jwtSecret: string;
  cookieSecret: string;
} {
  const appEnv = resolveAppEnv(env);
  const jwtSecret = env.JWT_SECRET ?? DEV_SECRET;
  const cookieSecret = env.COOKIE_SECRET ?? DEV_SECRET;

  if (appEnv === "production") {
    if (jwtSecret === DEV_SECRET || cookieSecret === DEV_SECRET) {
      throw new Error("production boot refused: JWT_SECRET/COOKIE_SECRET are dev defaults");
    }
    if (!env.MEDUSA_DATABASE_URL) {
      throw new Error("production boot refused: MEDUSA_DATABASE_URL is not set");
    }
  }

  return { appEnv, jwtSecret, cookieSecret };
}
