/**
 * Order ownership (auth plan phase 2), in raw SQL on the shared pg
 * connection like allocate.ts.
 *
 * An order belongs to an account when:
 * - it was placed while that account was signed in (checkout sets the owner),
 *   or
 * - the account confirmed it — a guest order placed on the account's phone,
 *   shown as "Is this your order?" rather than attached silently. Phone
 *   numbers are recycled by Indian carriers; the person holding a number
 *   today is not always the person who ordered on it last year, so a guest
 *   order is offered to the number's new owner, not handed over.
 */

type Binding = string | number | null;

/** Structural slice of knex so this file needs no knex type dependency. */
export interface SqlClient {
  raw(sql: string, bindings?: ReadonlyArray<Binding>): Promise<{ rows: unknown[] }>;
}

export interface OwnedIdentityRow {
  id: string;
  order_id: string;
  order_number: string;
  access_key: string;
  customer_id: string | null;
  claimed_at: Date | string | null;
  created_at: Date | string;
}

const COLUMNS = "id, order_id, order_number, access_key, customer_id, claimed_at, created_at";

/** Mark an order as the signed-in shopper's. Never overwrites an owner. */
export async function setOwnerIfUnowned(
  pg: SqlClient,
  orderId: string,
  customerId: string,
): Promise<void> {
  await pg.raw(
    `UPDATE siumora_order_identity
        SET customer_id = ?, updated_at = now()
      WHERE order_id = ? AND customer_id IS NULL AND deleted_at IS NULL`,
    [customerId, orderId],
  );
}

/** The account's orders, newest first. */
export async function identitiesOwnedBy(
  pg: SqlClient,
  customerId: string,
  limit = 50,
): Promise<OwnedIdentityRow[]> {
  const result = await pg.raw(
    `SELECT ${COLUMNS} FROM siumora_order_identity
      WHERE customer_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT ?`,
    [customerId, limit],
  );
  return result.rows as OwnedIdentityRow[];
}

/** Of these orders, the ones nobody owns yet. */
export async function unownedIdentities(
  pg: SqlClient,
  orderIds: readonly string[],
): Promise<OwnedIdentityRow[]> {
  if (orderIds.length === 0) return [];
  const placeholders = orderIds.map(() => "?").join(", ");
  const result = await pg.raw(
    `SELECT ${COLUMNS} FROM siumora_order_identity
      WHERE order_id IN (${placeholders}) AND customer_id IS NULL AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [...orderIds],
  );
  return result.rows as OwnedIdentityRow[];
}

/**
 * Claim orders for an account. The `customer_id IS NULL` guard makes a
 * claim a one-time act: a race or a replay finds nothing left to take.
 */
export async function claimOrders(
  pg: SqlClient,
  orderIds: readonly string[],
  customerId: string,
  now: Date,
): Promise<number> {
  if (orderIds.length === 0) return 0;
  const placeholders = orderIds.map(() => "?").join(", ");
  const result = await pg.raw(
    `UPDATE siumora_order_identity
        SET customer_id = ?, claimed_at = ?, updated_at = ?
      WHERE order_id IN (${placeholders}) AND customer_id IS NULL AND deleted_at IS NULL
      RETURNING id`,
    [customerId, now.toISOString(), now.toISOString(), ...orderIds],
  );
  return result.rows.length;
}

/** Move every order one account owns to another (operator merge). */
export async function reassignOrders(
  pg: SqlClient,
  fromCustomerId: string,
  toCustomerId: string,
): Promise<number> {
  const result = await pg.raw(
    `UPDATE siumora_order_identity
        SET customer_id = ?, updated_at = now()
      WHERE customer_id = ? AND deleted_at IS NULL
      RETURNING id`,
    [toCustomerId, fromCustomerId],
  );
  return result.rows.length;
}
