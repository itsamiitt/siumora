import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { loadDomainOrders } from "../../../../lib/domain-orders";
import { requireOperator } from "../../../../lib/operator-gate";

/**
 * GET /admin/siumora/restock-queue — ended orders whose goods have not gone
 * back on the shelf, ported from apps/api/src/routes/orders.ts.
 *
 * Honesty note: the Fastify stack tracks a restocked marker and its restock
 * action mints inventory back; on this stack the queue is every order in
 * rto/returned, and putting the goods back is (for now) a stock adjustment
 * in the Medusa admin's inventory screens. The dedicated restock action —
 * with its own audit entry and once-only marker — rides the outbox/ops
 * wave; until then the queue is complete but does not shrink on restock.
 */
export const AUTHENTICATE = false;

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "orders:write");
  if (!operator) return;

  const records = await loadDomainOrders(req, { limit: 1000 });
  const awaiting = records.filter(
    (record) => record.order.status === "rto" || record.order.status === "returned",
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
