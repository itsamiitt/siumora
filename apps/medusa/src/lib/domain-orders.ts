import type { MedusaRequest } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import type { Order } from "@siumora/core";

import {
  toDomainOrder,
  type OrderWire,
  type OrderSidecars,
} from "./domain-order-shape";

/**
 * Load the shop's orders as core domain Orders — the shared read the M2 ops
 * routes (metrics, gstr1, remittances, cash-position) assemble their answers
 * from, so every desk describes the same order the same way.
 *
 * "The shop's orders" means orders with a siumora_order_identity row: those
 * are the SIU-numbered orders the checkout created. A draft order somebody
 * makes in the stock admin has no SIU identity and deliberately does not
 * appear on the ops desks until it goes through the real pipeline.
 *
 * Assembly is pure (domain-order-shape.ts); this file is the I/O: one
 * identity SELECT, one query.graph for the orders, and three sidecar SELECTs
 * (status rows, NDR attempt counts, invoice numbers).
 */

interface SqlClient {
  raw(
    sql: string,
    bindings: ReadonlyArray<string | number>,
  ): Promise<{ rows: unknown[] }>;
}

export interface DomainOrderRecord {
  readonly order: Order;
  readonly orderId: string;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export async function loadDomainOrders(
  req: MedusaRequest,
  options: { orderIds?: readonly string[]; limit?: number } = {},
): Promise<DomainOrderRecord[]> {
  const pg = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as SqlClient;

  const limit = options.limit ?? 1000;
  const identityResult = options.orderIds
    ? options.orderIds.length
      ? await pg.raw(
          `SELECT order_id, order_number FROM siumora_order_identity
            WHERE deleted_at IS NULL AND order_id IN (${placeholders(options.orderIds.length)})`,
          [...options.orderIds],
        )
      : { rows: [] }
    : await pg.raw(
        `SELECT order_id, order_number FROM siumora_order_identity
          WHERE deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT ?`,
        [limit],
      );
  const identities = identityResult.rows as Array<{
    order_id: string;
    order_number: string;
  }>;
  if (identities.length === 0) return [];

  const ids = identities.map((row) => row.order_id);
  const marks = placeholders(ids.length);

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const [{ data: orders }, statuses, ndrCounts, invoices] = await Promise.all([
    query.graph({
      entity: "order",
      fields: [
        "id",
        "status",
        "created_at",
        "shipping_total",
        "shipping_address.*",
        // items.* rather than a field list: quantity is a computed field
        // that resolves undefined when named explicitly (probed on 2.18.0).
        "items.*",
        "items.variant.id",
        "items.variant.metadata",
        "items.variant.product.metadata",
      ],
      filters: { id: ids },
    }),
    pg.raw(
      `SELECT order_id, status, ndr_reason FROM siumora_order_status
        WHERE deleted_at IS NULL AND order_id IN (${marks})`,
      ids,
    ),
    pg.raw(
      `SELECT order_id, count(*)::int AS n FROM siumora_ndr_events
        WHERE deleted_at IS NULL AND order_id IN (${marks})
        GROUP BY order_id`,
      ids,
    ),
    pg.raw(
      `SELECT order_id, invoice_number, buyer_gstin FROM gst_invoice
        WHERE deleted_at IS NULL AND order_id IN (${marks})`,
      ids,
    ),
  ]);

  const statusByOrder = new Map(
    (statuses.rows as Array<{ order_id: string; status: string; ndr_reason: string | null }>).map(
      (row) => [row.order_id, row],
    ),
  );
  const attemptsByOrder = new Map(
    (ndrCounts.rows as Array<{ order_id: string; n: number }>).map((row) => [
      row.order_id,
      row.n,
    ]),
  );
  const invoiceByOrder = new Map(
    (invoices.rows as Array<{ order_id: string; invoice_number: string; buyer_gstin: string | null }>).map(
      (row) => [row.order_id, row],
    ),
  );
  const wireById = new Map(
    (orders as unknown as OrderWire[]).map((wire) => [wire.id, wire]),
  );

  const records: DomainOrderRecord[] = [];
  for (const identity of identities) {
    const wire = wireById.get(identity.order_id);
    // An identity without its order — allocation ran but the order vanished.
    // The desks skip it rather than serving a half-order.
    if (!wire) continue;
    const sidecars: OrderSidecars = {
      orderNumber: identity.order_number,
      statusRow: statusByOrder.get(identity.order_id),
      ndrAttempts: attemptsByOrder.get(identity.order_id) ?? 0,
      invoice: invoiceByOrder.get(identity.order_id),
    };
    records.push({
      order: toDomainOrder(wire, sidecars),
      orderId: identity.order_id,
    });
  }
  return records;
}
