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
  /** Accepted by the destination. */
  | "sent"
  /** Attempted and refused enough times to stop. Needs a human. */
  | "failed"
  /** Never attempted: the destination is not configured in this environment. */
  | "skipped";

/** Attempts before a send stops retrying and asks for a human. */
export const MAX_SEND_ATTEMPTS = 5;

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
 * Take a batch of queued events to send.
 *
 * `SKIP LOCKED` so two workers draining at once take different rows rather than
 * both sending the same conversion — the unique index stops a duplicate *row*,
 * but nothing would stop a duplicate *post*.
 */
export async function claimPendingTrackingEvents(
  db: Database,
  limit = 50,
): Promise<TrackingRow[]> {
  const claimed = await db.execute(
    sql`SELECT * FROM tracking_events
        WHERE status = 'pending' AND attempts < ${MAX_SEND_ATTEMPTS}
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED`,
  );
  return claimed.rows as TrackingRow[];
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
 * Record a refusal.
 *
 * Stays `pending` until the attempts run out, then `failed` — a conversion
 * dropped quietly is how reported revenue drifts away from real revenue with
 * nobody noticing.
 */
export async function markTrackingEventFailed(
  db: Database,
  id: string,
): Promise<void> {
  await db
    .update(trackingEvents)
    .set({
      attempts: sql`${trackingEvents.attempts} + 1`,
      status: sql`CASE WHEN ${trackingEvents.attempts} + 1 >= ${MAX_SEND_ATTEMPTS} THEN 'failed' ELSE 'pending' END`,
    })
    .where(eq(trackingEvents.id, id));
}

export interface TrackingHealth {
  readonly pending: number;
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

  const health: Record<string, number> = { pending: 0, sent: 0, failed: 0, skipped: 0 };
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
