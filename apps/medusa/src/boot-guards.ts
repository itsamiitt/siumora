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
  MEDUSA_REDIS_URL?: string;
  COURIER_SIMULATION?: string;
  OTP_ECHO?: string;
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
    // Rate-limit counters (src/lib/rate-limit.ts) and sessions live in
    // Redis. Without it every process keeps its own counters, a restart
    // forgets every window, and the OTP endpoint's ceiling multiplies.
    if (!env.MEDUSA_REDIS_URL) {
      throw new Error("production boot refused: MEDUSA_REDIS_URL is not set");
    }
    // Development switches that would be holes in production (plan 16 B30):
    // the courier simulation lets a customer mark their own parcel
    // delivered, and OTP_ECHO hands the sign-in code back in the response.
    // Both are already inert there; a production env that sets them is a
    // misconfiguration worth refusing loudly rather than ignoring.
    if (env.COURIER_SIMULATION === "true") {
      throw new Error("production boot refused: COURIER_SIMULATION must not be set");
    }
    if (env.OTP_ECHO === "true") {
      throw new Error("production boot refused: OTP_ECHO must not be set");
    }
  }

  return { appEnv, jwtSecret, cookieSecret };
}
