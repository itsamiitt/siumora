import {
  MAX_NOTIFICATION_ATTEMPTS,
  claimDueNotifications,
  markNotificationFailed,
  markNotificationSent,
  markNotificationSkipped,
  reclaimStalledNotifications,
  type Database,
  type NotificationRow,
} from "@siumora/db";
import {
  renderTemplate,
  sendableOn,
  templateFor,
  type Channel,
} from "@siumora/core";

import type { MessageTransport } from "@siumora/messaging";

/**
 * Drain the notification outbox.
 *
 * The same shape as the conversion drain, and deliberately so — claim, send,
 * record, back off — but the failure modes differ enough to be worth their own
 * pass. A conversion that never arrives costs attribution; a delivery message
 * that never arrives costs a parcel.
 *
 * The transport contract and its provider clients live in
 * `@siumora/messaging`, shared with the API's synchronous OTP send (eng
 * review 4A) — re-exported here so existing imports keep working.
 */

export { unconfiguredTransport, type MessageTransport } from "@siumora/messaging";

export interface MessageDrainReport {
  readonly claimed: number;
  readonly sent: number;
  readonly retrying: number;
  readonly failed: number;
  readonly skipped: number;
  readonly reclaimed: number;
}

export async function drainNotifications(
  db: Database,
  transport: MessageTransport,
  options: { batchSize?: number; now?: Date } = {},
): Promise<MessageDrainReport> {
  const now = options.now ?? new Date();
  const reclaimed = await reclaimStalledNotifications(db, now);
  const batch = await claimDueNotifications(db, options.batchSize ?? 25, now);

  let sent = 0;
  let retrying = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of batch) {
    const attempt = await sendOne(transport, row);

    if (attempt.kind === "skipped") {
      await markNotificationSkipped(db, row.id, attempt.error);
      skipped += 1;
      continue;
    }

    if (attempt.kind === "sent") {
      await markNotificationSent(db, row.id, {
        channel: attempt.channel,
        ...(attempt.providerMessageId
          ? { providerMessageId: attempt.providerMessageId }
          : {}),
        now,
      });
      sent += 1;
      continue;
    }

    await markNotificationFailed(db, row.id, {
      error: attempt.error,
      permanent: attempt.kind === "permanent",
      now,
    });

    if (attempt.kind === "permanent" || row.attempts + 1 >= MAX_NOTIFICATION_ATTEMPTS) {
      failed += 1;
    } else {
      retrying += 1;
    }
  }

  return { claimed: batch.length, sent, retrying, failed, skipped, reclaimed };
}

type Attempt =
  | { kind: "sent"; channel: Channel; providerMessageId?: string }
  | { kind: "retry"; error: string }
  | { kind: "permanent"; error: string }
  /** Nothing was configured to carry it. A fact, not a failure to retry. */
  | { kind: "skipped"; error: string };

/**
 * Try each channel the template names, in order, until one takes it.
 *
 * Falling through is the point: WhatsApp is what gets read in India, but a
 * template pending re-approval or a number in cooldown must not silently cost
 * somebody their delivery notice. The first channel that accepts it wins and
 * the rest are not tried — a customer who gets the same message twice on two
 * channels stops reading either.
 */
async function sendOne(
  transport: MessageTransport,
  row: NotificationRow,
): Promise<Attempt> {
  const template = templateFor(row.templateKey);
  if (!template) {
    return { kind: "permanent", error: `no template named ${row.templateKey}` };
  }

  const rendered = renderTemplate(
    row.templateKey,
    row.variables as Record<string, string | number>,
  );
  if (!rendered.ok) {
    // A retry renders exactly the same missing variables. This is a bug
    // upstream and it should stop being retried and start being visible.
    return {
      kind: "permanent",
      error: `missing variables: ${rendered.missing.join(", ")}`,
    };
  }

  const usable = template.channels.filter(
    (channel) => transport.channels.includes(channel) && sendableOn(template, channel),
  );

  if (usable.length === 0) {
    return {
      kind: "skipped",
      error: `no configured channel for ${row.templateKey} (wanted ${template.channels.join(", ")})`,
    };
  }

  let lastError = "";
  for (const channel of usable) {
    try {
      const outcome = await transport.send(channel, row.recipient, rendered.body, {
        templateKey: row.templateKey,
        ...(template.dltTemplateId ? { dltTemplateId: template.dltTemplateId } : {}),
      });

      if (outcome.kind === "sent") {
        return {
          kind: "sent",
          channel,
          ...(outcome.providerMessageId
            ? { providerMessageId: outcome.providerMessageId }
            : {}),
        };
      }

      lastError = `${channel}: ${outcome.error}`;

      // A permanent refusal on one channel is not permanent on the next — a
      // WhatsApp template rejection says nothing about SMS. Only a refusal on
      // the last available channel ends the attempt.
    } catch (error) {
      lastError = `${channel}: ${String(error)}`;
    }
  }

  return { kind: "retry", error: lastError || "every channel refused" };
}

