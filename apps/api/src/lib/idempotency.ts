import { createHash } from "node:crypto";


import { sql, type Database } from "@siumora/db";

/**
 * Idempotency for mutating requests.
 *
 * A checkout gets retried — a flaky connection, an impatient second tap, a
 * client-side retry. Without a key, each attempt creates another order and
 * charges again. With one, the second attempt collides on the primary key and
 * returns the first response.
 *
 * The request body is hashed alongside the key so that reusing a key for a
 * *different* request is rejected rather than silently returning someone else's
 * result.
 */

export type IdempotencyOutcome<T> =
  | { status: "executed"; value: T }
  | { status: "replayed"; value: T }
  | { status: "in_progress" }
  | { status: "key_reused" };

export function hashRequest(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

/**
 * Run `operation` at most once per key.
 *
 * The claim is an INSERT that either wins or collides — Postgres decides,
 * which is what makes this safe across processes. Checking for the row first
 * and then inserting would leave a window where two requests both find nothing.
 */
export async function withIdempotency<T>(
  db: Database,
  key: string | undefined,
  body: unknown,
  operation: () => Promise<T>,
): Promise<IdempotencyOutcome<T>> {
  // No key means the caller accepts at-least-once. Do not invent one: a
  // server-generated key would be different on every retry and guarantee
  // nothing.
  if (!key) return { status: "executed", value: await operation() };

  const requestHash = hashRequest(body);

  const claim = await db.execute(sql`
    INSERT INTO idempotency_keys (key, request_hash, status)
    VALUES (${key}, ${requestHash}, 'in_progress')
    ON CONFLICT (key) DO NOTHING
    RETURNING key
  `);

  if (claim.rows.length === 0) {
    const existing = await db.execute(sql`
      SELECT request_hash, status, response FROM idempotency_keys WHERE key = ${key}
    `);
    const row = existing.rows[0] as
      | { request_hash: string; status: string; response: T | null }
      | undefined;

    if (!row) return { status: "executed", value: await operation() };
    if (row.request_hash !== requestHash) return { status: "key_reused" };

    // Still running elsewhere. The caller should retry rather than receive a
    // half-finished answer.
    if (row.status !== "completed" || row.response === null) {
      return { status: "in_progress" };
    }

    return { status: "replayed", value: row.response };
  }

  try {
    const value = await operation();
    await db.execute(sql`
      UPDATE idempotency_keys
      SET response = ${JSON.stringify(value)}::jsonb, status = 'completed'
      WHERE key = ${key}
    `);
    return { status: "executed", value };
  } catch (error) {
    // Release the key so a genuine retry can succeed. Leaving it claimed would
    // make a transient failure permanent for that key.
    await db.execute(sql`DELETE FROM idempotency_keys WHERE key = ${key}`);
    throw error;
  }
}
