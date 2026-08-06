import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import {
  findIdentityByNumber,
  type SqlClient as IdentitySqlClient,
} from "../siumora-order/allocate";
import { isWellFormedAccessKey } from "../siumora-order/identity";
import { ensureStatusRow, type SqlClient, type StatusRow } from "./data";
import { initialSiumoraStatus } from "./lifecycle";

/**
 * The key/owner auth arms for every route that acts on an order — the shape
 * of the sibling order read (api/store/siumora/orders/[number]/route.ts),
 * copied rather than imported because that file is owned elsewhere; it is
 * also Fastify's authorised() helper: authorising the read but not the
 * write would leave the interesting half open.
 *
 * The recorded contract (apps/api/src/sdk-contract.test.ts):
 * - a MALFORMED key (not a uuid) is a 400 invalid_request;
 * - NO key, a wrong-but-well-formed key, or an unknown number are all the
 *   same 404 not_found — never a 403, because a 403 would confirm the order
 *   number is real, which is exactly what an enumeration walk is after;
 * - owning the order (Medusa customer auth_context) or holding the key
 *   issued at checkout grants access. The operator grant arrives with the
 *   M2 operator module.
 */

export interface AuthorisedOrder {
  /** The Siumora identity row: order_id, order_number, access_key. */
  readonly orderId: string;
  readonly orderNumber: string;
  /** This module's status row, lazily created (see data.ts header). */
  readonly statusRow: StatusRow;
  /** When the Medusa order was placed — the fallback returns clock. */
  readonly placedAt: string | Date;
  readonly pg: SqlClient;
}

export async function authoriseOrder(
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<AuthorisedOrder | undefined> {
  const number = req.params.number!;
  const rawKey = req.query.key;
  const key = typeof rawKey === "string" ? rawKey : undefined;

  // Malformed key: the 400 arm. Shaped like the Fastify zod-failure 400s.
  if (
    (rawKey !== undefined && typeof rawKey !== "string") ||
    (key !== undefined && !isWellFormedAccessKey(key))
  ) {
    res.status(400).json({
      error: "invalid_request",
      message: "key: expected a UUID access key",
    });
    return undefined;
  }

  const pg = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as SqlClient;
  const identity = await findIdentityByNumber(pg as unknown as IdentitySqlClient, number);
  if (!identity) {
    res.status(404).json({ error: "not_found" });
    return undefined;
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "status", "created_at", "customer_id"],
    filters: { id: identity.order_id },
  });
  const order = orders[0] as
    | {
        id: string;
        status: string;
        created_at: string | Date;
        customer_id: string | null;
      }
    | undefined;
  if (!order) {
    // An identity without its order — to a guest that is indistinguishable
    // from "no such order".
    res.status(404).json({ error: "not_found" });
    return undefined;
  }

  // Owning the order (session) or holding the key issued at checkout — the
  // same two grants the Fastify route honours. Everything else: 404.
  const actorId = (req as { auth_context?: { actor_id?: string } }).auth_context
    ?.actor_id;
  const isOwner = Boolean(
    actorId && order.customer_id && actorId === order.customer_id,
  );
  const holdsKey = key !== undefined && key === identity.access_key;
  if (!isOwner && !holdsKey) {
    res.status(404).json({ error: "not_found" });
    return undefined;
  }

  const statusRow = await ensureStatusRow(
    pg,
    identity.order_id,
    initialSiumoraStatus(order.status),
  );

  return {
    orderId: identity.order_id,
    orderNumber: identity.order_number,
    statusRow,
    placedAt: order.created_at,
    pg,
  };
}
