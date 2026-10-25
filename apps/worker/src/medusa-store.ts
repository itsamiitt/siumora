import type { ConversionRow, FailOptions, MessageRow, OutboxStore } from "./store.ts";

/**
 * The Medusa outbox (plan 16 Phase G) — `siumora_tracking_events` and
 * `siumora_notifications`, written by apps/medusa's order hub
 * (src/lib/order-events.ts). The same semantics as the Fastify repositories,
 * statement for statement:
 *
 * - the claim selects due rows FOR UPDATE SKIP LOCKED and flips them to
 *   `sending` in one statement, so two workers never post the same row and
 *   no connection is held across a third party's latency;
 * - a claim older than the timeout belonged to a worker that died, and goes
 *   back to `pending` without charging an attempt;
 * - a failure backs off exponentially from the row's own attempt count and
 *   becomes `failed` when the attempts run out (or at once when permanent).
 */

/** The slice of pg the store needs — a Pool or a Client. */
export interface PgClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>;
}

export const MAX_CONVERSION_ATTEMPTS = 5;
export const MAX_MESSAGE_ATTEMPTS = 5;
const CLAIM_TIMEOUT_MS = 5 * 60_000;

function claimSql(table: string, max: number, returning: string): string {
  return `WITH due AS (
            SELECT id FROM ${table}
            WHERE status = 'pending' AND deleted_at IS NULL
              AND attempts < ${max}
              AND next_attempt_at <= $1
            ORDER BY created_at ASC
            LIMIT $2
            FOR UPDATE SKIP LOCKED
          )
          UPDATE ${table} t
          SET status = 'sending', updated_at = now()
          FROM due
          WHERE t.id = due.id
          RETURNING ${returning}`;
}

function failSql(table: string, max: number, baseSeconds: number, factor: number, capSeconds: number): string {
  return `UPDATE ${table}
             SET attempts = attempts + 1,
                 status = CASE WHEN $2::boolean THEN 'failed'
                               WHEN attempts + 1 >= ${max} THEN 'failed'
                               ELSE 'pending' END,
                 next_attempt_at = $3::timestamptz
                   + make_interval(secs => least(${baseSeconds} * power(${factor}, greatest(attempts, 0)), ${capSeconds})),
                 last_error = COALESCE($4, last_error),
                 updated_at = now()
           WHERE id = $1`;
}

export function medusaStore(client: PgClient): OutboxStore {
  const reclaim = async (table: string, now: Date) => {
    const cutoff = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
    const result = await client.query(
      `UPDATE ${table} SET status = 'pending', updated_at = now()
        WHERE status = 'sending' AND next_attempt_at <= $1
        RETURNING id`,
      [cutoff],
    );
    return result.rows.length;
  };
  const fail = (sql: string) => async (id: string, options: FailOptions) => {
    await client.query(sql, [
      id,
      options.permanent === true,
      options.now ?? new Date(),
      options.error ? options.error.slice(0, 500) : null,
    ]);
  };

  return {
    name: "medusa",
    maxConversionAttempts: MAX_CONVERSION_ATTEMPTS,
    maxMessageAttempts: MAX_MESSAGE_ATTEMPTS,

    reclaimConversions: (now) => reclaim("siumora_tracking_events", now),
    async claimConversions(limit, now) {
      const result = await client.query(
        claimSql("siumora_tracking_events", MAX_CONVERSION_ATTEMPTS, "t.id, t.destination, t.attempts, t.payload"),
        [now, limit],
      );
      return result.rows as ConversionRow[];
    },
    async markConversionSent(id, now) {
      await client.query(
        `UPDATE siumora_tracking_events SET status = 'sent', sent_at = $2, attempts = attempts + 1, updated_at = now() WHERE id = $1`,
        [id, now],
      );
    },
    // 30s, 2m, 8m, 32m — capped so Meta still dedupes inside its window.
    markConversionFailed: fail(failSql("siumora_tracking_events", MAX_CONVERSION_ATTEMPTS, 30, 4, 1800)),

    reclaimMessages: (now) => reclaim("siumora_notifications", now),
    async claimMessages(limit, now) {
      const result = await client.query(
        claimSql(
          "siumora_notifications",
          MAX_MESSAGE_ATTEMPTS,
          `t.id, t.template_key AS "templateKey", t.recipient, t.variables, t.attempts`,
        ),
        [now, limit],
      );
      return result.rows as MessageRow[];
    },
    async markMessageSent(id, options) {
      await client.query(
        `UPDATE siumora_notifications
            SET status = 'sent', channel = $2, provider_message_id = COALESCE($3, provider_message_id),
                sent_at = $4, attempts = attempts + 1, updated_at = now()
          WHERE id = $1`,
        [id, options.channel, options.providerMessageId ?? null, options.now ?? new Date()],
      );
    },
    async markMessageSkipped(id, reason) {
      await client.query(
        `UPDATE siumora_notifications SET status = 'skipped', last_error = $2, updated_at = now() WHERE id = $1`,
        [id, reason.slice(0, 500)],
      );
    },
    // 1m, 5m, 25m, ~2h — a delivery notice is worth chasing for hours.
    markMessageFailed: fail(failSql("siumora_notifications", MAX_MESSAGE_ATTEMPTS, 60, 5, 14400)),
  };
}
