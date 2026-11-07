import { randomUUID } from "node:crypto";

// prettier-ignore -- single line so @ts-ignore reaches the specifier
// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { evaluateSend, nextSendableAt, renderTemplate, templateFor } from "@siumora/core";

import type { MessageIntent } from "./compose.ts";

/**
 * The outbox's writes, in raw SQL against the shared pg connection — the
 * same convention as the other Siumora modules, and the same semantics as
 * the Fastify repositories (packages/db notification-repository.ts,
 * tracking-repository.ts) so apps/worker drains either one identically.
 */

export interface SqlClient {
  raw(
    sql: string,
    bindings?: ReadonlyArray<string | number | boolean | null | Date>,
  ): Promise<{ rows: unknown[] }>;
}

const mintId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`;

export type EnqueueOutcome =
  | { queued: true; id: string }
  | { queued: false; reason: string; id?: string };

/**
 * Queue a customer message. A recipient who opted out gets nothing (a
 * person asking outranks a template); quiet hours defer rather than drop;
 * a duplicate event is a no-op; a message that cannot render is recorded
 * as failed so the gap is visible, never silently skipped.
 */
export async function enqueueNotification(
  client: SqlClient,
  intent: MessageIntent,
  now: Date = new Date(),
): Promise<EnqueueOutcome> {
  const template = templateFor(intent.templateKey);
  if (!template) return { queued: false, reason: "unknown_template" };

  const prefs = await client.raw(
    `SELECT marketing_consent, opted_out FROM siumora_notification_preferences
      WHERE recipient = ? AND deleted_at IS NULL`,
    [intent.recipient],
  );
  const preference = prefs.rows[0] as { marketing_consent?: boolean; opted_out?: boolean } | undefined;
  const decision = evaluateSend(intent.templateKey, {
    ...(preference || intent.consented
      ? { marketingConsent: intent.consented === true || Boolean(preference?.marketing_consent) }
      : {}),
    ...(preference ? { optedOut: Boolean(preference.opted_out) } : {}),
    now,
  });
  if (!decision.send && decision.reason !== "quiet_hours") {
    return { queued: false, reason: decision.reason };
  }

  const rendered = renderTemplate(intent.templateKey, intent.variables);
  const inserted = await client.raw(
    `INSERT INTO siumora_notifications
       (id, event_key, template_key, category, recipient, order_id, customer_id, variables,
        status, last_error, next_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, now(), now())
     ON CONFLICT (event_key, template_key) DO NOTHING
     RETURNING id`,
    [
      mintId("sintf"),
      intent.eventKey,
      intent.templateKey,
      template.category,
      intent.recipient,
      intent.orderId,
      intent.customerId ?? null,
      JSON.stringify(intent.variables),
      rendered.ok ? "pending" : "failed",
      rendered.ok ? null : `missing variables: ${rendered.missing.join(", ")}`,
      decision.send ? now : nextSendableAt(now),
    ],
  );
  const id = (inserted.rows[0] as { id?: string } | undefined)?.id;
  if (!id) return { queued: false, reason: "duplicate" };
  if (!rendered.ok) return { queued: false, reason: "unrenderable", id };
  return { queued: true, id };
}

/**
 * Queue a conversion for one destination. A destination that is not
 * configured — or a GA4 event with no client id — is recorded as skipped,
 * so the ledger can tell "not configured" from "never queued".
 */
export async function recordTrackingEvent(
  client: SqlClient,
  input: {
    eventId: string;
    eventName: string;
    destination: "ga4" | "meta";
    payload: unknown;
    orderId: string;
    status: "pending" | "skipped";
  },
  now: Date = new Date(),
): Promise<boolean> {
  const inserted = await client.raw(
    `INSERT INTO siumora_tracking_events
       (id, event_id, event_name, order_id, destination, status, payload, next_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, now(), now())
     ON CONFLICT (event_id, destination) DO NOTHING
     RETURNING id`,
    [
      mintId("sitev"),
      input.eventId,
      input.eventName,
      input.orderId,
      input.destination,
      input.status,
      JSON.stringify(input.payload ?? null),
      now,
    ],
  );
  return inserted.rows.length > 0;
}

const DELIVERY_RANK: Record<string, number> = { sent: 0, delivered: 1, read: 2 };

/**
 * A provider's delivery receipt moves a message forward to the truth —
 * sent → delivered → read, never backwards, and a failure is final. A
 * receipt for an unknown message is acknowledged as unknown.
 */
export async function applyDeliveryReceipt(
  client: SqlClient,
  providerMessageId: string,
  status: "delivered" | "read" | "failed",
  error?: string,
): Promise<"updated" | "ignored" | "unknown"> {
  const found = await client.raw(
    `SELECT id, status FROM siumora_notifications WHERE provider_message_id = ? AND deleted_at IS NULL`,
    [providerMessageId],
  );
  const row = found.rows[0] as { id: string; status: string } | undefined;
  if (!row) return "unknown";
  const current = DELIVERY_RANK[row.status];
  if (current === undefined) return "ignored";
  if (status === "failed") {
    await client.raw(
      `UPDATE siumora_notifications SET status = 'failed', last_error = COALESCE(?, last_error), updated_at = now() WHERE id = ?`,
      [error ? error.slice(0, 500) : null, row.id],
    );
    return "updated";
  }
  if (DELIVERY_RANK[status]! <= current) return "ignored";
  await client.raw(`UPDATE siumora_notifications SET status = ?, updated_at = now() WHERE id = ?`, [status, row.id]);
  return "updated";
}

/**
 * Erasure (plan 16 Phase H): nothing queued may still carry an erased
 * person — their unsent messages and conversions are withdrawn, sent ones
 * lose the number and variables, and their messaging preferences are
 * forgotten. The rows themselves stay as anonymous counts for the health
 * report.
 */
export async function forgetRecipient(
  client: SqlClient,
  input: { phone: string; orderIds: readonly string[] },
): Promise<void> {
  await client.raw(
    `UPDATE siumora_notifications
        SET recipient = 'erased', variables = '{}'::jsonb,
            status = CASE WHEN status IN ('pending', 'sending') THEN 'skipped' ELSE status END,
            last_error = CASE WHEN status IN ('pending', 'sending') THEN 'erased on request' ELSE last_error END,
            updated_at = now()
      WHERE recipient = ?`,
    [input.phone],
  );
  if (input.orderIds.length > 0) {
    await client.raw(
      `UPDATE siumora_tracking_events
          SET payload = NULL,
              status = CASE WHEN status IN ('pending', 'sending') THEN 'skipped' ELSE status END,
              last_error = CASE WHEN status IN ('pending', 'sending') THEN 'erased on request' ELSE last_error END,
              updated_at = now()
        WHERE order_id IN (${input.orderIds.map(() => "?").join(", ")})`,
      [...input.orderIds],
    );
  }
  await client.raw(`DELETE FROM siumora_notification_preferences WHERE recipient = ?`, [input.phone]);
  // A pending cart reminder to that number goes too (plan 16 B22).
  await client.raw(`DELETE FROM siumora_cart_reminders WHERE phone = ?`, [input.phone]);
}

export interface OutboxHealth {
  messages: Record<string, number>;
  conversions: Record<string, number>;
}

/** Counts by status — a backlog or a wall of failures shows here first. */
export async function outboxHealth(client: SqlClient): Promise<OutboxHealth> {
  const count = async (table: string) => {
    const result = await client.raw(
      `SELECT status, count(*)::int AS n FROM ${table} WHERE deleted_at IS NULL GROUP BY status`,
    );
    return Object.fromEntries(
      (result.rows as Array<{ status: string; n: number }>).map((row) => [row.status, Number(row.n)]),
    );
  };
  return {
    messages: await count("siumora_notifications"),
    conversions: await count("siumora_tracking_events"),
  };
}

// ── Cart reminders (plan 16 B22) ─────────────────────────────────────────

export interface CartReminderRow {
  id: string;
  cart_id: string;
  phone: string;
  consented_at: Date | string;
  status: string;
}

/**
 * Record the opt-in for this cart (or move it to a corrected number). A
 * reminder already queued or skipped is not re-armed: one per cart, ever.
 */
export async function recordReminderConsent(
  client: SqlClient,
  input: { cartId: string; phone: string; now: Date },
): Promise<void> {
  await client.raw(
    `INSERT INTO siumora_cart_reminders (id, cart_id, phone, consented_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'waiting', now(), now())
     ON CONFLICT (cart_id) WHERE deleted_at IS NULL
     DO UPDATE SET phone = EXCLUDED.phone, consented_at = EXCLUDED.consented_at, updated_at = now()
       WHERE siumora_cart_reminders.status = 'waiting'`,
    [mintId("sicrm"), input.cartId, input.phone, input.now],
  );
}

/** The shopper unticked the box: no reminder for this cart. */
export async function withdrawReminderConsent(client: SqlClient, cartId: string): Promise<void> {
  await client.raw(
    `UPDATE siumora_cart_reminders SET status = 'skipped', reason = 'withdrawn', updated_at = now()
      WHERE cart_id = ? AND status = 'waiting' AND deleted_at IS NULL`,
    [cartId],
  );
}

/** Opted-in carts old enough to be due, oldest first. */
export async function dueReminders(client: SqlClient, consentedBefore: Date, limit = 100): Promise<CartReminderRow[]> {
  const result = await client.raw(
    `SELECT id, cart_id, phone, consented_at, status FROM siumora_cart_reminders
      WHERE status = 'waiting' AND consented_at <= ? AND deleted_at IS NULL
      ORDER BY consented_at ASC LIMIT ?`,
    [consentedBefore, limit],
  );
  return result.rows as CartReminderRow[];
}

export async function settleReminder(
  client: SqlClient,
  id: string,
  status: "queued" | "skipped",
  reason?: string,
): Promise<void> {
  await client.raw(
    `UPDATE siumora_cart_reminders SET status = ?, reason = ?, updated_at = now() WHERE id = ? AND status = 'waiting'`,
    [status, reason ?? null, id],
  );
}

/**
 * Whether a cart reminder already went to this phone since `since` (security
 * review, item 7): one per phone per day, however many carts name it.
 */
export async function reminderSentToPhoneSince(client: SqlClient, phone: string, since: Date): Promise<boolean> {
  const result = await client.raw(
    `SELECT 1 FROM siumora_cart_reminders
      WHERE phone = ? AND status = 'queued' AND updated_at >= ? AND deleted_at IS NULL LIMIT 1`,
    [phone, since],
  );
  return result.rows.length > 0;
}
