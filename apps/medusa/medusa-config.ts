import { defineConfig, loadEnv } from "@medusajs/framework/utils";

loadEnv(process.env.NODE_ENV || "development", process.cwd());

/**
 * APP_ENV, not NODE_ENV, gates behavior (same rule as the Fastify stack:
 * managed staging runs NODE_ENV=production, so NODE_ENV cannot tell staging
 * from production). The boot guards below are the Medusa port of
 * assertBootSafety — the config loader is this stack's one choke point.
 */
const appEnv = process.env.APP_ENV ?? "development";
if (!["development", "staging", "production"].includes(appEnv)) {
  throw new Error(`APP_ENV must be development|staging|production, got "${appEnv}"`);
}

const DEV_SECRET = "supersecret-dev-only";
const jwtSecret = process.env.JWT_SECRET ?? DEV_SECRET;
const cookieSecret = process.env.COOKIE_SECRET ?? DEV_SECRET;

if (appEnv === "production") {
  if (jwtSecret === DEV_SECRET || cookieSecret === DEV_SECRET) {
    throw new Error("production boot refused: JWT_SECRET/COOKIE_SECRET are dev defaults");
  }
  if (!process.env.MEDUSA_DATABASE_URL) {
    throw new Error("production boot refused: MEDUSA_DATABASE_URL is not set");
  }
}

export default defineConfig({
  projectConfig: {
    databaseUrl:
      process.env.MEDUSA_DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5432/siumora_medusa",
    // No redisUrl locally: dev runs on the in-memory event bus / workflow
    // engine. Production sets MEDUSA_REDIS_URL (Upstash Mumbai) — a
    // checkout-path dependency, priced in the design doc.
    ...(process.env.MEDUSA_REDIS_URL ? { redisUrl: process.env.MEDUSA_REDIS_URL } : {}),
    http: {
      storeCors: process.env.STORE_CORS ?? "http://localhost:3000",
      adminCors: process.env.ADMIN_CORS ?? "http://localhost:9000",
      authCors: process.env.AUTH_CORS ?? "http://localhost:3000,http://localhost:9000",
      jwtSecret,
      cookieSecret,
    },
  },
});
