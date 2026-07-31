import { randomUUID } from "node:crypto";

import { ORDER_NUMBER_SQL, type IdentityRow } from "./identity";

/**
 * The allocation write-path, in raw SQL against the shared pg connection
 * (ContainerRegistrationKeys.PG_CONNECTION — a knex client).
 *
 * Why raw SQL and not the module service: the whole point of the allocation
 * is that the sequence draw, the number formatting and the row insert are ONE
 * atomic statement. Split across a nextval query and a create() call there is
 * a window where a crash burns a number without a row, and no window at all
 * is cheaper than a small one.
 *
 * Concurrency disposition (also written into the module migration):
 * - `nextval('siumora_order_number_seq')` is atomic in Postgres — two
 *   concurrent transactions can never draw the same value, so double-issue
 *   is impossible by construction, enforced by the database.
 * - `ON CONFLICT (order_id) WHERE deleted_at IS NULL DO NOTHING` (the
 *   predicate matches the partial unique index the module migration created)
 *   makes the insert idempotent per order: the route, its replays, and the
 *   order.placed subscriber can all race and exactly one row wins; losers
 *   re-read the winner. A losing race burns a sequence value — a gap, which
 *   order numbers are allowed (gaplessness is the GST invoice series'
 *   burden, M2 gst module).
 * - The idempotency_key partial unique index refuses the same key minting
 *   two different orders; that violation surfaces as kind "key_conflict"
 *   for the route to turn into the Fastify 422.
 */

/** Structural slice of knex so this file needs no knex type dependency. */
export interface SqlClient {
  raw(sql: string, bindings: ReadonlyArray<string | null>): Promise<{ rows: IdentityRow[] }>;
}

const COLUMNS =
  "id, order_id, cart_id, order_number, access_key, idempotency_key, created_at";

export async function findIdentityByOrderId(
  client: SqlClient,
  orderId: string,
): Promise<IdentityRow | undefined> {
  const result = await client.raw(
    `SELECT ${COLUMNS} FROM siumora_order_identity WHERE order_id = ? AND deleted_at IS NULL`,
    [orderId],
  );
  return result.rows[0];
}

export async function findIdentityByNumber(
  client: SqlClient,
  orderNumber: string,
): Promise<IdentityRow | undefined> {
  const result = await client.raw(
    `SELECT ${COLUMNS} FROM siumora_order_identity WHERE order_number = ? AND deleted_at IS NULL`,
    [orderNumber],
  );
  return result.rows[0];
}

export async function findIdentityByIdempotencyKey(
  client: SqlClient,
  key: string,
): Promise<IdentityRow | undefined> {
  const result = await client.raw(
    `SELECT ${COLUMNS} FROM siumora_order_identity WHERE idempotency_key = ? AND deleted_at IS NULL`,
    [key],
  );
  return result.rows[0];
}

export type AllocationResult =
  | { kind: "allocated" | "existing"; identity: IdentityRow }
  | { kind: "key_conflict"; existing: IdentityRow };

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}

/**
 * Allocate (or find) the identity row for a placed order.
 *
 * Exactly one row per order ever exists; see the file comment for how each
 * race resolves. When the row already existed but carried no idempotency
 * key (the subscriber allocated first, or an earlier call sent no header),
 * the caller's key is patched on so later replays keep finding it.
 */
export async function allocateIdentity(
  client: SqlClient,
  input: { orderId: string; cartId: string | null; idempotencyKey: string | null },
): Promise<AllocationResult> {
  const id = `sioid_${randomUUID().replaceAll("-", "")}`;
  const accessKey = randomUUID();

  let inserted: IdentityRow | undefined;
  try {
    const result = await client.raw(
      `INSERT INTO siumora_order_identity
         (id, order_id, cart_id, order_number, access_key, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, ${ORDER_NUMBER_SQL}, ?, ?, now(), now())
       ON CONFLICT (order_id) WHERE deleted_at IS NULL DO NOTHING
       RETURNING ${COLUMNS}`,
      [id, input.orderId, input.cartId, accessKey, input.idempotencyKey],
    );
    inserted = result.rows[0];
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // The idempotency key (or, in a pathological race, the number) already
    // exists on another row. The key case is the meaningful one: the same
    // key was used for a different order.
    const existing = input.idempotencyKey
      ? await findIdentityByIdempotencyKey(client, input.idempotencyKey)
      : undefined;
    if (existing) return { kind: "key_conflict", existing };
    throw error;
  }

  if (inserted) return { kind: "allocated", identity: inserted };

  // Lost the per-order race (or the order was already allocated earlier) —
  // the winner's row is the identity. Patch the idempotency key and cart on
  // if the winner had none (the subscriber allocates with neither); COALESCE
  // never overwrites a value already recorded. A unique violation here means
  // the key already lives on another order's row — leave the row as it was
  // and let the caller's replay lookup see that row instead.
  if (input.idempotencyKey || input.cartId) {
    try {
      await client.raw(
        `UPDATE siumora_order_identity
            SET idempotency_key = COALESCE(idempotency_key, ?),
                cart_id = COALESCE(cart_id, ?),
                updated_at = now()
          WHERE order_id = ? AND deleted_at IS NULL`,
        [input.idempotencyKey, input.cartId, input.orderId],
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  const existing = await findIdentityByOrderId(client, input.orderId);
  if (!existing) {
    // ON CONFLICT DO NOTHING returned nothing AND no row exists: only a
    // concurrent hard-delete could produce this. Surface it loudly.
    throw new Error(
      `identity allocation for order ${input.orderId} found neither insert nor row`,
    );
  }
  return { kind: "existing", identity: existing };
}
