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
      // Operators sign in with emailpass; customers only ever with the
      // phone-OTP provider. Absent, every provider serves every actor.
      authMethodsPerActor: {
        user: ["emailpass"],
        customer: ["phone-otp"],
      },
    },
  },
  modules: [
    // Siumora order identity (design doc M1): SIU-XXXXX order numbers and
    // guest access keys as a module-owned table + sequence. defineConfig
    // merges this list with the default modules, so the stock commerce
    // modules (incl. the manual fulfillment and system payment providers
    // the COD complete route leans on) stay registered.
    { resolve: "./src/modules/siumora-order" },
    {
      // Phone-OTP sign-in (design doc M1): the Fastify OTP contract as a
      // Medusa auth provider, reusing packages/messaging's ordered channel
      // resolution (WhatsApp when its template is approved, else DLT SMS).
      resolve: "@medusajs/medusa/auth",
      options: {
        providers: [
          // Overriding the auth module REPLACES its default provider list,
          // it does not merge — emailpass must stay or admin login dies.
          { resolve: "@medusajs/medusa/auth-emailpass", id: "emailpass" },
          {
            resolve: "./src/modules/phone-auth",
            id: "phone-otp",
            options: {
              // Echoes the issued code in the request-step payload.
              // Development only — validateOptions refuses the combination
              // otpEcho && appEnv === "production" at boot (the same guard
              // the Fastify app.ts enforces).
              otpEcho: process.env.OTP_ECHO === "true",
              appEnv: process.env.APP_ENV,
              // Explicit rather than process.env wholesale, so the wiring
              // is readable off the config. Missing credentials mean no
              // sender; sign-in then refuses unless otpEcho covers dev.
              transport: {
                WHATSAPP_BSP_URL: process.env.WHATSAPP_BSP_URL,
                WHATSAPP_BSP_KEY: process.env.WHATSAPP_BSP_KEY,
                WHATSAPP_TEXT_TEMPLATE: process.env.WHATSAPP_TEXT_TEMPLATE,
                WHATSAPP_OTP_TEMPLATE: process.env.WHATSAPP_OTP_TEMPLATE,
                MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY,
                MSG91_OTP_TEMPLATE_ID: process.env.MSG91_OTP_TEMPLATE_ID,
              },
            },
          },
        ],
      },
    },
  ],
});
