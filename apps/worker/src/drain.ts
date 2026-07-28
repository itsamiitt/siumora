import {
  MAX_SEND_ATTEMPTS,
  claimPendingTrackingEvents,
  markTrackingEventFailed,
  markTrackingEventSent,
  reclaimStalledTrackingEvents,
  type Database,
  type TrackingDestination,
  type TrackingRow,
} from "@siumora/db";

import type { SendOutcome, Transport } from "./transport.ts";

/**
 * Drain the conversion outbox.
 *
 * The API writes every server-side conversion to `tracking_events` and returns
 * immediately — a checkout must not wait on Meta. This is the other half: it
 * claims what is due, posts it, and records what happened.
 *
 * Ordering is deliberate throughout. A row is claimed before it is sent, and
 * marked after; a crash in between leaves it claimed, and the reclaim pass puts
 * it back. The alternative — send first, record after — loses exactly the
 * events worth knowing about, because the failure that loses the record is the
 * same failure that lost the send.
 */

export interface DrainOptions {
  readonly batchSize?: number;
  /** How many posts are in flight at once. */
  readonly concurrency?: number;
  readonly now?: Date;
}

export interface DrainReport {
  readonly claimed: number;
  readonly sent: number;
  readonly retrying: number;
  readonly failed: number;
  /** Claims from a worker that died, put back on the queue. */
  readonly reclaimed: number;
}

const DEFAULT_BATCH = 50;
const DEFAULT_CONCURRENCY = 5;

export async function drainConversions(
  db: Database,
  transport: Transport,
  options: DrainOptions = {},
): Promise<DrainReport> {
  const now = options.now ?? new Date();

  // Before claiming anything new, so a stranded row rejoins the same pass that
  // would otherwise go looking for work and find none.
  const reclaimed = await reclaimStalledTrackingEvents(db, now);

  const batch = await claimPendingTrackingEvents(
    db,
    options.batchSize ?? DEFAULT_BATCH,
    now,
  );

  let sent = 0;
  let retrying = 0;
  let failed = 0;

  const outcomes = await mapWithLimit(
    batch,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    async (row) => ({ row, outcome: await sendOne(transport, row) }),
  );

  for (const { row, outcome } of outcomes) {
    if (outcome.kind === "sent") {
      await markTrackingEventSent(db, row.id, now);
      sent += 1;
      continue;
    }

    await markTrackingEventFailed(db, row.id, {
      error: outcome.error,
      permanent: outcome.kind === "permanent",
      now,
    });

    // A permanent refusal is finished with; a retryable one has attempts left
    // unless this was the last. Counted from what was recorded, not guessed.
    if (outcome.kind === "permanent" || row.attempts + 1 >= MAX_SEND_ATTEMPTS) {
      failed += 1;
    } else {
      retrying += 1;
    }
  }

  return { claimed: batch.length, sent, retrying, failed, reclaimed };
}

async function sendOne(
  transport: Transport,
  row: TrackingRow,
): Promise<SendOutcome> {
  if (row.payload === null || row.payload === undefined) {
    // Nothing to post and nothing a retry would produce. This is a bug upstream
    // rather than a transport problem, and it should stop being retried and
    // start being visible.
    return { kind: "permanent", error: "ledger row has no payload" };
  }

  try {
    return await transport.send(
      row.destination as TrackingDestination,
      row.payload,
    );
  } catch (error) {
    // A transport that throws instead of returning is a bug, but not one worth
    // stranding the row in `sending` over.
    return { kind: "retry", error: String(error) };
  }
}

/**
 * Run `worker` over `items`, at most `limit` at a time.
 *
 * Bounded because the batch can be fifty rows and neither destination wants
 * fifty simultaneous posts from one client — and an unbounded fan-out is how a
 * backlog turns into a rate limit turns into a longer backlog.
 */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index] as T);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run),
  );

  return results;
}
