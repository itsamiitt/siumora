import type { Database } from "@siumora/db";

import { drainConversions, type DrainReport } from "./drain.ts";
import { drainNotifications, type MessageDrainReport, type MessageTransport } from "./messages.ts";
import type { Transport } from "./transport.ts";

/**
 * The loop.
 *
 * A Postgres-backed poller rather than the hosted queue plan/01 sketches. The
 * ledger already has to exist for dedup and for the parity report, so the queue
 * is a projection of a table this system keeps anyway — and one fewer service
 * to hold credentials for. If throughput ever outgrows polling, the drain is
 * the part worth keeping and the loop is the part to replace.
 */

export interface WorkerOptions {
  readonly intervalMs?: number;
  readonly batchSize?: number;
  readonly log?: (report: DrainReport) => void;
  readonly logMessages?: (report: MessageDrainReport) => void;
  /** Omitted, no messages are drained — the conversion queue still is. */
  readonly messages?: MessageTransport;
  /** Injected in tests, so a run is deterministic instead of timing-dependent. */
  readonly signal?: AbortSignal;
}

const DEFAULT_INTERVAL_MS = 15_000;

/**
 * Run until aborted.
 *
 * Each pass is awaited before the next is scheduled, so a slow drain delays the
 * following pass rather than overlapping with it — overlapping passes would
 * claim each other's rows and turn one backlog into two.
 */
export async function runWorker(
  db: Database,
  transport: Transport,
  options: WorkerOptions = {},
): Promise<void> {
  const interval = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  while (!options.signal?.aborted) {
    try {
      const report = await drainConversions(db, transport, {
        ...(options.batchSize ? { batchSize: options.batchSize } : {}),
      });
      // Silent when there was nothing to do: a log line every fifteen seconds
      // saying "0" trains everyone to stop reading the log.
      if (report.claimed > 0 || report.reclaimed > 0) options.log?.(report);

      if (options.messages) {
        // After the conversions, in the same pass. Separate queues, one loop:
        // two loops would double the polling for no benefit, and a message is
        // not more urgent than the pixel that says the order happened.
        const messages = await drainNotifications(db, options.messages);
        if (messages.claimed > 0 || messages.reclaimed > 0) {
          options.logMessages?.(messages);
        }
      }
    } catch (error) {
      // The database went away, most likely. Keep looping: the next pass will
      // either reconnect or fail the same way, and exiting would need an
      // orchestrator to notice and restart.
      console.error("[worker] drain failed", error);
    }

    await sleep(interval, options.signal);
  }
}

/** Resolves early when aborted, so shutdown does not wait out the interval. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });

    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
  });
}
