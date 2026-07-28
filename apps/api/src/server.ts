import { connectionStringFromEnv } from "@siumora/db";

import { buildApp } from "./app.ts";

/** Process entry point. Configuration comes from the environment only. */
const { server, pool } = await buildApp({
  connectionString: connectionStringFromEnv(),
  ssl: process.env.DATABASE_SSL === "true",
  corsOrigins: (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  courierWebhookSecret: process.env.COURIER_WEBHOOK_SECRET,
  adminPhones: process.env.ADMIN_PHONES,
  // Flipped on once a WhatsApp/DLT template sender exists. Until then sign-in
  // is either refused or, under OTP_ECHO, returns the code for development.
  otpDeliveryConfigured: process.env.WHATSAPP_OTP_TEMPLATE !== undefined,
  otpEcho: process.env.OTP_ECHO === "true",
  courierSimulation:
    process.env.COURIER_SIMULATION === "true" ||
    (process.env.COURIER_SIMULATION === undefined &&
      process.env.NODE_ENV !== "production"),
  ga4Configured: process.env.GA4_API_SECRET !== undefined,
  metaConfigured: process.env.META_CAPI_TOKEN !== undefined,
  hsts: process.env.NODE_ENV === "production",
  // Cloudflare and the load balancer in plan/11 §1 both sit in front of this,
  // and behind either one the socket address is the proxy's — which would put
  // the whole internet in a single rate-limit bucket.
  trustProxy: process.env.TRUST_PROXY === "true",
  logger: true,
});

const port = Number(process.env.PORT ?? 4000);
await server.listen({ port, host: "0.0.0.0" });

/**
 * Drain on shutdown.
 *
 * Without this a deploy kills in-flight checkouts mid-transaction. Fastify
 * stops accepting new connections and finishes what it has, then the pool
 * closes.
 */
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void (async () => {
      await server.close();
      await pool.end();
      process.exit(0);
    })();
  });
}
