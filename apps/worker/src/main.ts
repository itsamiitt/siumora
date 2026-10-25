import { connectionStringFromEnv, createDb, createPool } from "@siumora/db";
import { createTransport } from "@siumora/messaging";

import { medusaStore } from "./medusa-store.ts";
import { drizzleStore } from "./store.ts";
import { configuredDestinations, httpTransport } from "./transport.ts";
import { runWorker } from "./worker.ts";

/**
 * Process entry point.
 *
 * A small pool: this is one process doing one thing at a fixed concurrency, and
 * taking ten connections from a database sized for the API would be rude.
 */
// Which outbox to drain (plan 16 Phases G, J): the Medusa one — its tables
// live in Medusa's database — unless OUTBOX_BACKEND=fastify names the old
// ledger, which goes with Fastify. Said out loud below; a worker draining
// the wrong database looks exactly like a worker with nothing to do.
const outboxBackend = process.env.OUTBOX_BACKEND ?? "medusa";
if (outboxBackend !== "medusa" && outboxBackend !== "fastify") {
  throw new Error(`OUTBOX_BACKEND must be medusa|fastify, got "${outboxBackend}"`);
}
const onMedusa = outboxBackend === "medusa";
if (onMedusa && !process.env.MEDUSA_DATABASE_URL) {
  throw new Error("The worker drains the Medusa outbox: set MEDUSA_DATABASE_URL (or OUTBOX_BACKEND=fastify for the old ledger).");
}
const pool = createPool({
  connectionString: onMedusa ? process.env.MEDUSA_DATABASE_URL! : connectionStringFromEnv(),
  ssl: process.env.DATABASE_SSL === "true",
  max: 4,
});
const store = onMedusa ? medusaStore(pool) : drizzleStore(createDb(pool));
console.log(`[worker] draining the ${store.name} outbox`);

const transportConfig = {
  ...(process.env.GA4_MEASUREMENT_ID
    ? { ga4MeasurementId: process.env.GA4_MEASUREMENT_ID }
    : {}),
  ...(process.env.GA4_API_SECRET ? { ga4ApiSecret: process.env.GA4_API_SECRET } : {}),
  ...(process.env.META_PIXEL_ID ? { metaPixelId: process.env.META_PIXEL_ID } : {}),
  ...(process.env.META_CAPI_TOKEN
    ? { metaAccessToken: process.env.META_CAPI_TOKEN }
    : {}),
};

const destinations = configuredDestinations(transportConfig);

// Said out loud at startup. A worker draining happily into nothing looks
// identical to a worker that is working, and the difference is every
// conversion.
console.log(
  destinations.length > 0
    ? `[worker] sending to ${destinations.join(", ")}`
    : "[worker] no destination configured — queued conversions will be marked unsendable",
);

const controller = new AbortController();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    // Aborting ends the sleep immediately; the pass in flight finishes first,
    // so nothing is left claimed by a worker that no longer exists.
    console.log(`[worker] ${signal} — finishing the current pass`);
    controller.abort();
  });
}

// Assembled from whatever credentials this environment holds — WhatsApp BSP,
// MSG91 DLT SMS, Resend email (eng review 4A). With none configured the queue
// still drains: every message is marked skipped with the channel it wanted, so
// the gap between orders and messages stays visible rather than looking like
// nothing happened.
const messages = createTransport(process.env);
console.log(
  messages.channels.length > 0
    ? `[worker] messaging via ${messages.channels.join(", ")}`
    : "[worker] no messaging provider configured — queued messages will be marked skipped",
);

await runWorker(store, httpTransport(transportConfig), {
  intervalMs: Number(process.env.WORKER_INTERVAL_MS ?? 15_000),
  signal: controller.signal,
  messages,
  log: (report) =>
    console.log(
      `[worker] conversions claimed=${report.claimed} sent=${report.sent} retrying=${report.retrying} failed=${report.failed} reclaimed=${report.reclaimed}`,
    ),
  logMessages: (report) =>
    console.log(
      `[worker] messages claimed=${report.claimed} sent=${report.sent} skipped=${report.skipped} retrying=${report.retrying} failed=${report.failed}`,
    ),
});

await pool.end();
