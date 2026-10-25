import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { loadDomainOrders } from "../../../../lib/domain-orders";
import { requireOperator } from "../../../../lib/operator-gate";
import type { SqlClient } from "../../../../modules/returns-ndr/data";

/**
 * GET /admin/siumora/restock-queue — ended orders whose goods have not gone
 * back on the shelf, ported from apps/api/src/routes/orders.ts: every order
 * in rto/returned without the restocked_at marker. "Put back in stock" on
 * the order's page (POST …/orders/:number/restock, plan 16 B29) adjusts
 * Medusa's inventory once and takes the order off this queue.
 */
export const AUTHENTICATE = false;

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "orders:write");
  if (!operator) return;

  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlClient;
  const [records, restocked] = await Promise.all([
    loadDomainOrders(req, { limit: 1000 }),
    pg.raw(
      `SELECT order_id FROM siumora_order_status WHERE restocked_at IS NOT NULL AND deleted_at IS NULL`,
      [],
    ),
  ]);
  const done = new Set((restocked.rows as Array<{ order_id: string }>).map((row) => row.order_id));
  const awaiting = records.filter(
    (record) =>
      (record.order.status === "rto" || record.order.status === "returned") && !done.has(record.orderId),
  );

  res.setHeader("Cache-Control", "no-store");
  res.json({
    orders: awaiting.map((record) => ({
      number: record.order.number,
      status: record.order.status,
      placedAt: record.order.placedAt,
      total: record.order.totals.total,
    })),
  });
}
