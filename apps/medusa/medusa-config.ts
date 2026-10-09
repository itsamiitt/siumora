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
      // 9000 is Medusa's default port (CI boots there); 9101 is the local
      // no-watcher convention (`PORT=9101 npx medusa start`). The dashboard
      // is served same-origin at /app, so both ports must be admissible.
      adminCors: process.env.ADMIN_CORS ?? "http://localhost:9000,http://localhost:9101",
      authCors:
        process.env.AUTH_CORS ??
        "http://localhost:3000,http://localhost:9000,http://localhost:9101",
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
    // Product images (M4). The file module accepts exactly one provider and
    // registers file-local by default, so dev needs no block at all — uploads
    // land under ./static and serve from the backend. Production points at
    // Cloudflare R2 through the S3-compatible provider; like every other
    // adapter in this repo the credentials are an env-shaped hole, and the
    // block only exists once S3_FILE_URL is set so a half-configured provider
    // can never shadow the working local default.
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          process.env.S3_FILE_URL
            ? {
                resolve: "@medusajs/medusa/file-s3",
                id: "s3",
                options: {
                  file_url: process.env.S3_FILE_URL,
                  access_key_id: process.env.S3_ACCESS_KEY_ID,
                  secret_access_key: process.env.S3_SECRET_ACCESS_KEY,
                  region: process.env.S3_REGION ?? "auto",
                  bucket: process.env.S3_BUCKET,
                  endpoint: process.env.S3_ENDPOINT,
                },
              }
            : {
                resolve: "@medusajs/medusa/file-local",
                id: "local",
                options: {
                  // The provider bakes an ABSOLUTE url into every upload
                  // row at write time, defaulting to localhost:9000 — the
                  // local no-watcher convention runs on 9101, so left
                  // alone every dashboard upload 404s from the storefront.
                  // FILE_LOCAL_BACKEND_URL names the public origin when the
                  // backend sits behind a reverse proxy (nginx serving
                  // /static) and R2 is not configured yet: without it, a
                  // production process stamps its own localhost into every
                  // row. The same env-shaped hole as every other adapter.
                  backend_url:
                    process.env.FILE_LOCAL_BACKEND_URL ??
                    `http://localhost:${process.env.PORT ?? "9000"}/static`,
                },
              },
        ],
      },
    },
    // Siumora order identity (design doc M1): SIU-XXXXX order numbers and
    // guest access keys as a module-owned table + sequence. defineConfig
    // merges this list with the default modules, so the stock commerce
    // modules (incl. the manual fulfillment and system payment providers
    // the COD complete route leans on) stay registered.
    { resolve: "./src/modules/siumora-order" },
    // M2 India modules (design doc): the statutory invoice series, the
    // Siumora status machine + returns policy, pincode serviceability, the
    // kill-switch settings, and the wishlist.
    { resolve: "./src/modules/gst" },
    { resolve: "./src/modules/returns-ndr" },
    { resolve: "./src/modules/serviceability" },
    { resolve: "./src/modules/settings" },
    { resolve: "./src/modules/wishlist" },
    { resolve: "./src/modules/waitlist" },
    // M2 wave B ops surface: the operator audit log every /admin/siumora
    // write testifies to, and the COD remittance ledger.
    { resolve: "./src/modules/audit" },
    { resolve: "./src/modules/remittance" },
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
