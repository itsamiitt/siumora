import { defineConfig, loadEnv } from "@medusajs/framework/utils";

import { assertMedusaBootSafety } from "./src/boot-guards";

loadEnv(process.env.NODE_ENV || "development", process.cwd());

// The config loader is this stack's one choke point — the Medusa port of
// assertBootSafety. The guards themselves are pure and tested in
// src/boot-guards.test.ts.
const { jwtSecret, cookieSecret } = assertMedusaBootSafety(process.env);

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
