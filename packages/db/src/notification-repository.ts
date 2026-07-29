import { and, asc, eq, inArray, sql } from "drizzle-orm";

import {
  evaluateSend,
  nextSendableAt,
  renderTemplate,
  templateFor,
  type Channel,
  type SendRefusal,
} from "@siumora/core";

import type { Database } from "./client.ts";
import { notificationPreferences, notifications } from "./schema.ts";

/**
 * The notification outbox.
 *
 * Nothing here sends anything. Enqueuing decides *whether* a message is owed
 * and writes it down; the worker decides how to get it out. That split is why a
 * checkout does not wait on WhatsApp, and why a provider outage is a queue
 * rather than a hole in the order history.
 */

export type NotificationRow = typeof notifications.$inferSelect;

/** Attempts before a message stops retrying and asks for a human. */
export const MAX_NOTIFICATION_ATTEMPTS = 5;

/** 1m, 5m, 25m, 2h. Slower than a pixel send: a person will wait a minute. */
export function notificationBackoffMs(attempts: number): number {
  return Math.min(60_000 * 5 ** Math.max(0, attempts - 1), 4 * 3600_000);
}

export interface EnqueueInput {
  /** One row per event per template. A replayed webhook produces one message. */
  readonly eventKey: string;
  readonly templateKey: string;
  readonly recipient: string;
  readonly variables: Readonly<Record<string, string | number>>;
  readonly orderId?: string;
  readonly customerId?: string;
  readonly now?: Date;
}

export interface EnqueueResult {
  readonly queued: boolean;
  /** Set when it was not queued, or was queued as unsendable. */
  readonly reason?: SendRefusal | "unrenderable" | "duplicate";
  readonly id?: string;
}

/**
 * Queue a message, if one is owed.
 *
 * The refusals are recorded differently on purpose. An opt-out or a missing
 * consent means no row at all — there is nothing to retry and a queue full of
 * messages nobody may send is a queue nobody reads. Quiet hours mean a row with
 * a later `next_attempt_at`, because the message is still owed, just not yet.
 * And an unrenderable template is written as `failed`, because that is a bug
 * upstream and it should be visible rather than silently dropped.
 */
export async function enqueueNotification(
  db: Database,
  input: EnqueueInput,
): Promise<EnqueueResult> {
  const now = input.now ?? new Date();
  const template = templateFor(input.templateKey);
  if (!template) return { queued: false, reason: "unknown_template" };

  const [preference] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.recipient, input.recipient));

  const decision = evaluateSend(input.templateKey, {
    ...(preference ? { marketingConsent: preference.marketingConsent } : {}),
    ...(preference ? { optedOut: preference.optedOut } : {}),
    now,
  });

  if (!decision.send && decision.reason !== "quiet_hours") {
    return { queued: false, reason: decision.reason };
  }

  const rendered = renderTemplate(input.templateKey, input.variables);

  const [row] = await db
    .insert(notifications)
    .values({
      eventKey: input.eventKey,
      templateKey: input.templateKey,
      category: template.category,
      recipient: input.recipient,
      ...(input.orderId ? { orderId: input.orderId } : {}),
      ...(input.customerId ? { customerId: input.customerId } : {}),
      variables: input.variables,
      // Only a quiet-hours refusal defers. Deferring unconditionally would hold
      // a delivery notice raised at eleven at night until nine the next
      // morning, which is the worst hour to be silent about a parcel.
      nextAttemptAt: decision.send ? now : nextSendableAt(now),
      ...(rendered.ok
        ? {}
        : {
            status: "failed" as const,
            lastError: `missing variables: ${rendered.missing.join(", ")}`,
          }),
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });

  if (!row) return { queued: false, reason: "duplicate" };
  if (!rendered.ok) return { queued: false, reason: "unrenderable", id: row.id };

  return { queued: true, id: row.id };
}

/**
 * Take a batch of due messages.
 *
 * The same written-down claim the conversion outbox uses, for the same reason:
 * a lock held across a provider call ties a database connection to somebody
 * else's latency, and without a claim two workers send the same message twice.
 */
export async function claimDueNotifications(
  db: Database,
  limit = 25,
  now: Date = new Date(),
): Promise<NotificationRow[]> {
  const claimed = await db.execute(
    sql`WITH due AS (
          SELECT id FROM notifications
          WHERE status = 'pending'
            AND attempts < ${MAX_NOTIFICATION_ATTEMPTS}
            AND next_attempt_at <= ${now}
          ORDER BY created_at ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE notifications n
        SET status = 'sending'
        FROM due
        WHERE n.id = due.id
        RETURNING n.id,
                  n.event_key    AS "eventKey",
                  n.template_key AS "templateKey",
                  n.category,
                  n.recipient,
                  n.order_id     AS "orderId",
                  n.customer_id  AS "customerId",
                  n.variables,
                  n.channel,
                  n.status,
                  n.attempts,
                  n.next_attempt_at AS "nextAttemptAt",
                  n.created_at      AS "createdAt"`,
  );
  // Aliased column by column, not `n.*`: raw SQL comes back in the database's
  // snake_case, and a caller reading `templateKey` off it gets undefined —
  // which fails as "no such template" rather than as a naming mistake.
  return claimed.rows as NotificationRow[];
}

/** Put back claims from a worker that died. Attempts is not charged. */
export async function reclaimStalledNotifications(
  db: Database,
  now: Date = new Date(),
  timeoutMs = 5 * 60_000,
): Promise<number> {
  const cutoff = new Date(now.getTime() - timeoutMs);
  const reclaimed = await db
    .update(notifications)
    .set({ status: "pending" })
    .where(
      and(
        eq(notifications.status, "sending"),
        sql`${notifications.nextAttemptAt} <= ${cutoff}`,
      ),
    )
    .returning({ id: notifications.id });

  return reclaimed.length;
}

export async function markNotificationSent(
  db: Database,
  id: string,
  options: { channel: Channel; providerMessageId?: string; now?: Date },
): Promise<void> {
  await db
    .update(notifications)
    .set({
      status: "sent",
      channel: options.channel,
      ...(options.providerMessageId
        ? { providerMessageId: options.providerMessageId }
        : {}),
      sentAt: options.now ?? new Date(),
      attempts: sql`${notifications.attempts} + 1`,
    })
    .where(eq(notifications.id, id));
}

export type DeliveryStatus = "delivered" | "read" | "failed";

const DELIVERY_RANK: Record<string, number> = {
  sent: 0,
  delivered: 1,
  read: 2,
};

/**
 * Apply a provider delivery receipt (eng review 1A).
 *
 * Receipts retry and arrive out of order, so the update is a ranked
 * transition, not an assignment: `read` never regresses to `delivered`, a
 * replay is a no-op, and a receipt for a row that was never sent (or for an
 * id nobody knows) changes nothing and says so. `failed` records the
 * provider's post-acceptance failure — the paused-template case — with the
 * reason, and only from a sent/delivered row.
 */
export async function applyDeliveryReceipt(
  db: Database,
  providerMessageId: string,
  status: DeliveryStatus,
  error?: string,
): Promise<"updated" | "ignored" | "unknown"> {
  const [row] = await db
    .select({ id: notifications.id, status: notifications.status })
    .from(notifications)
    .where(eq(notifications.providerMessageId, providerMessageId));

  if (!row) return "unknown";

  const currentRank = DELIVERY_RANK[row.status];
  if (currentRank === undefined) return "ignored"; // pending/skipped/failed rows never move on a receipt

  if (status === "failed") {
    await db
      .update(notifications)
      .set({
        status: "failed",
        ...(error ? { lastError: error.slice(0, 500) } : {}),
      })
      .where(eq(notifications.id, row.id));
    return "updated";
  }

  if (DELIVERY_RANK[status]! <= currentRank) return "ignored";

  await db
    .update(notifications)
    .set({ status })
    .where(eq(notifications.id, row.id));
  return "updated";
}

/** Nothing was configured to carry it. Not a failure to retry — a fact. */
export async function markNotificationSkipped(
  db: Database,
  id: string,
  reason: string,
): Promise<void> {
  await db
    .update(notifications)
    .set({ status: "skipped", lastError: reason.slice(0, 500) })
    .where(eq(notifications.id, id));
}

export async function markNotificationFailed(
  db: Database,
  id: string,
  options: { error?: string; permanent?: boolean; now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();

  await db
    .update(notifications)
    .set({
      attempts: sql`${notifications.attempts} + 1`,
      status: options.permanent
        ? "failed"
        : sql`CASE WHEN ${notifications.attempts} + 1 >= ${MAX_NOTIFICATION_ATTEMPTS} THEN 'failed' ELSE 'pending' END`,
      nextAttemptAt: sql`${now}::timestamptz + make_interval(secs => least(60 * power(5, greatest(${notifications.attempts}, 0)), 14400))`,
      ...(options.error ? { lastError: options.error.slice(0, 500) } : {}),
    })
    .where(eq(notifications.id, id));
}

export interface NotificationHealth {
  readonly pending: number;
  readonly sending: number;
  readonly sent: number;
  readonly failed: number;
  readonly skipped: number;
}

export async function notificationHealth(
  db: Database,
): Promise<NotificationHealth> {
  const rows = await db
    .select({
      status: notifications.status,
      count: sql<number>`count(*)::int`,
    })
    .from(notifications)
    .groupBy(notifications.status);

  const health: Record<string, number> = {
    pending: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };
  for (const row of rows) health[row.status] = row.count;

  return health as unknown as NotificationHealth;
}

/** Record a preference. Opting out is one row and outranks everything. */
export async function setNotificationPreference(
  db: Database,
  recipient: string,
  preference: { marketingConsent?: boolean; optedOut?: boolean },
): Promise<void> {
  await db
    .insert(notificationPreferences)
    .values({
      recipient,
      marketingConsent: preference.marketingConsent ?? false,
      optedOut: preference.optedOut ?? false,
    })
    .onConflictDoUpdate({
      target: notificationPreferences.recipient,
      set: {
        ...(preference.marketingConsent !== undefined
          ? { marketingConsent: preference.marketingConsent }
          : {}),
        ...(preference.optedOut !== undefined
          ? { optedOut: preference.optedOut }
          : {}),
        updatedAt: new Date(),
      },
    });
}

/** Messages queued against one order, newest first. For the order timeline. */
export async function notificationsForOrder(
  db: Database,
  orderId: string,
): Promise<NotificationRow[]> {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.orderId, orderId))
    .orderBy(asc(notifications.createdAt));
}

/** Messages that ran out of attempts. The queue an operator has to work. */
export async function failedNotifications(
  db: Database,
  limit = 100,
): Promise<NotificationRow[]> {
  return db
    .select()
    .from(notifications)
    .where(inArray(notifications.status, ["failed"]))
    .orderBy(asc(notifications.createdAt))
    .limit(limit);
}
