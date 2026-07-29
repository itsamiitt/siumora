import { connectionStringFromEnv, createDb, createPool } from "@siumora/db";
import { createTransport } from "@siumora/messaging";

import { configuredDestinations, httpTransport } from "./transport.ts";
import { runWorker } from "./worker.ts";

/**
 * Process entry point.
 *
 * A small pool: this is one process doing one thing at a fixed concurrency, and
 * taking ten connections from a database sized for the API would be rude.
 */
const pool = createPool({
  connectionString: connectionStringFromEnv(),
  ssl: process.env.DATABASE_SSL === "true",
  max: 4,
});

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

await runWorker(createDb(pool), httpTransport(transportConfig), {
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
