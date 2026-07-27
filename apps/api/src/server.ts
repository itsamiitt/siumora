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
