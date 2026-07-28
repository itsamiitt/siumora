import { and, asc, eq, sql } from "drizzle-orm";

import type { Database } from "./client.ts";
import { trackingEvents } from "./schema.ts";

/**
 * The tracking ledger.
 *
 * Every server-side conversion is written here before anything is sent, and the
 * row is the record of whether it ever arrived. Three things depend on that:
 *
 * - **Dedup.** The browser pixel and the server send carry the same `event_id`;
 *   the unique index on `(event_id, destination)` means a retried checkout, a
 *   replayed webhook or a second worker cannot queue the same conversion twice.
 * - **Retry.** A failed CAPI post has to be retried with the *same* event_id or
 *   the retry lands as a second conversion. Keeping the payload means the retry
 *   is a replay, not a re-derivation from state that has since moved on.
 * - **Reconciliation.** Doc 08 §8 wants order-to-GA4 parity watched. That is a
 *   comparison between this table and `orders`, and it needs both sides.
 */

export type TrackingDestination = "ga4" | "meta";

export type TrackingStatus =
  /** Queued, not yet attempted. */
  | "pending"
  /** Claimed by a worker and in flight. */
  | "sending"
  /** Accepted by the destination. */
  | "sent"
  /** Attempted and refused enough times to stop. Needs a human. */
  | "failed"
  /** Never attempted: the destination is not configured in this environment. */
  | "skipped";

/** Attempts before a send stops retrying and asks for a human. */
export const MAX_SEND_ATTEMPTS = 5;

/**
 * How long to wait before attempt n+1: 30s, 2m, 8m, 32m.
 *
 * Exponential rather than fixed because the failures worth retrying are the
 * ones that clear on their own — a rate limit, a bad minute at the far end —
 * and hammering those is how a queue earns a ban. Capped so a conversion is
 * still delivered inside the window Meta will dedupe it in.
 */
export function retryDelayMs(attempts: number): number {
  return Math.min(30_000 * 4 ** Math.max(0, attempts - 1), 30 * 60_000);
}

/**
 * A claim this old is assumed to belong to a worker that died.
 *
 * Long enough that a slow-but-live send is not stolen out from under itself;
 * short enough that a crash does not strand a conversion for a day.
 */
export const CLAIM_TIMEOUT_MS = 5 * 60_000;

export interface RecordTrackingInput {
  /** Minted once, shared with the browser pixel. The dedup key. */
  readonly eventId: string;
  readonly eventName: string;
  readonly destination: TrackingDestination;
  readonly payload: unknown;
  readonly orderId?: string;
  readonly status?: TrackingStatus;
}

/**
 * Queue a conversion.
 *
 * `onConflictDoNothing` rather than an upsert: if this event is already in the
 * ledger it has either been sent or is about to be, and overwriting the payload
 * would change what a retry replays.
 *
 * Returns whether a row was actually created, which is what tells a caller
 * "this is the first time" versus "this is a replay".
 */
export async function recordTrackingEvent(
  db: Database,
  input: RecordTrackingInput,
): Promise<boolean> {
  const created = await db
    .insert(trackingEvents)
    .values({
      eventId: input.eventId,
      eventName: input.eventName,
      destination: input.destination,
      payload: input.payload,
      status: input.status ?? "pending",
      ...(input.orderId ? { orderId: input.orderId } : {}),
    })
    .onConflictDoNothing()
    .returning({ id: trackingEvents.id });

  return created.length > 0;
}

export type TrackingRow = typeof trackingEvents.$inferSelect;

/**
 * Take a batch of due events to send.
 *
 * The claim is written down, not held as a lock. `SKIP LOCKED` alone only
 * reserves a row for the length of its transaction, and the alternative —
 * keeping that transaction open across an HTTP call — ties a database
 * connection to a third party's latency. So the select and the flip to
 * `sending` happen in one statement, and the connection is free while the post
 * is in flight.
 *
 * Two workers therefore take different rows. The unique index stops a duplicate
 * *row*; nothing but the claim stops a duplicate *post*.
 */
export async function claimPendingTrackingEvents(
  db: Database,
  limit = 50,
  now: Date = new Date(),
): Promise<TrackingRow[]> {
  const claimed = await db.execute(
    sql`WITH due AS (
          SELECT id FROM tracking_events
          WHERE status = 'pending'
            AND attempts < ${MAX_SEND_ATTEMPTS}
            AND next_attempt_at <= ${now}
          ORDER BY created_at ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE tracking_events t
        SET status = 'sending'
        FROM due
        WHERE t.id = due.id
        RETURNING t.id,
                  t.event_id   AS "eventId",
                  t.event_name AS "eventName",
                  t.order_id   AS "orderId",
                  t.destination,
                  t.status,
                  t.attempts,
                  t.payload,
                  t.next_attempt_at AS "nextAttemptAt",
                  t.created_at      AS "createdAt"`,
  );
  // Aliased rather than `t.*`. The columns this drain happens to read are all
  // single words, so `*` worked by luck; a caller reaching for `eventName`
  // would have got undefined and no error.
  return claimed.rows as TrackingRow[];
}

/**
 * Put stranded claims back on the queue.
 *
 * A worker killed mid-send leaves its rows in `sending` forever, and a
 * conversion nobody will ever retry is indistinguishable from one that arrived.
 * Attempts is not bumped: the row was claimed, not refused, and charging it for
 * somebody else's crash would burn the retry budget.
 */
export async function reclaimStalledTrackingEvents(
  db: Database,
  now: Date = new Date(),
  timeoutMs = CLAIM_TIMEOUT_MS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - timeoutMs);
  const reclaimed = await db
    .update(trackingEvents)
    .set({ status: "pending" })
    .where(
      and(
        eq(trackingEvents.status, "sending"),
        sql`${trackingEvents.nextAttemptAt} <= ${cutoff}`,
      ),
    )
    .returning({ id: trackingEvents.id });

  return reclaimed.length;
}

export async function markTrackingEventSent(
  db: Database,
  id: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(trackingEvents)
    .set({ status: "sent", sentAt: now, attempts: sql`${trackingEvents.attempts} + 1` })
    .where(eq(trackingEvents.id, id));
}

/**
 * Record a refusal and schedule the retry.
 *
 * Stays `pending` until the attempts run out, then `failed` — a conversion
 * dropped quietly is how reported revenue drifts away from real revenue with
 * nobody noticing.
 *
 * `permanent` skips the remaining attempts. A malformed payload or a rejected
 * credential does not become valid by being sent four more times, and the
 * retries only delay the moment somebody notices.
 */
export async function markTrackingEventFailed(
  db: Database,
  id: string,
  options: { error?: string; permanent?: boolean; now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();

  await db
    .update(trackingEvents)
    .set({
      attempts: sql`${trackingEvents.attempts} + 1`,
      status: options.permanent
        ? "failed"
        : sql`CASE WHEN ${trackingEvents.attempts} + 1 >= ${MAX_SEND_ATTEMPTS} THEN 'failed' ELSE 'pending' END`,
      // Computed from the row's own attempt count, so a retry that raced with
      // another worker still backs off by its true position in the sequence.
      nextAttemptAt: sql`${now}::timestamptz + make_interval(secs => least(30 * power(4, greatest(${trackingEvents.attempts}, 0)), 1800))`,
      ...(options.error ? { lastError: options.error.slice(0, 500) } : {}),
    })
    .where(eq(trackingEvents.id, id));
}

export interface TrackingHealth {
  readonly pending: number;
  /** Claimed and in flight. Persistently non-zero means a worker is stuck. */
  readonly sending: number;
  readonly sent: number;
  readonly failed: number;
  readonly skipped: number;
}

/** Counts by status, for the marketing-health panel in doc 08 §8. */
export async function trackingHealth(db: Database): Promise<TrackingHealth> {
  const rows = await db
    .select({
      status: trackingEvents.status,
      count: sql<number>`count(*)::int`,
    })
    .from(trackingEvents)
    .groupBy(trackingEvents.status);

  const health: Record<string, number> = {
    pending: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };
  for (const row of rows) health[row.status] = row.count;

  return health as unknown as TrackingHealth;
}

/**
 * Orders that should have produced a purchase conversion but have none.
 *
 * The parity check doc 08 §8 asks for, stated as a query rather than a metric
 * somebody eyeballs: any gap here is revenue the ad platforms cannot see.
 */
export async function ordersMissingConversion(
  db: Database,
  limit = 50,
): Promise<Array<{ number: string; status: string; eventId: string }>> {
  const rows = await db.execute(
    sql`SELECT o.number, o.status, o.event_id AS "eventId"
        FROM orders o
        WHERE o.status IN ('confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered')
          AND NOT EXISTS (
            SELECT 1 FROM tracking_events t
            WHERE t.event_id = o.event_id AND t.event_name IN ('purchase', 'cod_delivered')
          )
        ORDER BY o.placed_at DESC
        LIMIT ${limit}`,
  );
  return rows.rows as Array<{ number: string; status: string; eventId: string }>;
}

/** Every ledger row for one event id, across destinations. */
export async function trackingEventsFor(
  db: Database,
  eventId: string,
): Promise<TrackingRow[]> {
  return db
    .select()
    .from(trackingEvents)
    .where(eq(trackingEvents.eventId, eventId))
    .orderBy(asc(trackingEvents.destination));
}

/** Whether this conversion has already been queued for a destination. */
export async function hasTrackingEvent(
  db: Database,
  eventId: string,
  destination: TrackingDestination,
): Promise<boolean> {
  const [row] = await db
    .select({ id: trackingEvents.id })
    .from(trackingEvents)
    .where(
      and(
        eq(trackingEvents.eventId, eventId),
        eq(trackingEvents.destination, destination),
      ),
    );
  return row !== undefined;
}
