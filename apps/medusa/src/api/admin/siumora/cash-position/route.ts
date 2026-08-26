import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { cashPosition } from "@siumora/core";

import { loadDomainOrders } from "../../../../lib/domain-orders";
import { requireOperator } from "../../../../lib/operator-gate";
import {
  reconciledOrderNumbers,
  type SqlClient,
} from "../../../../modules/remittance/data";

/**
 * GET /admin/siumora/cash-position — where the money is today, ported from
 * apps/api/src/routes/remittance.ts. Separate from the batch report because
 * it is the one number the daily digest wants.
 *
 * The join matters: an order is "remitted" only when a settled remittance
 * row exists for it. Reading the order status alone would count every
 * delivered COD parcel as paid, which is exactly the number that is wrong.
 */
export const AUTHENTICATE = false;

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "metrics:read");
  if (!operator) return;

  const pg = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as SqlClient;
  const [records, reconciled] = await Promise.all([
    loadDomainOrders(req, { limit: 5000 }),
    reconciledOrderNumbers(pg),
  ]);

  res.setHeader("Cache-Control", "no-store");
  res.json(
    cashPosition(
      records.map((record) => ({
        total: record.order.totals.total,
        paymentMethod: record.order.paymentMethod,
        status: record.order.status,
        reconciled: reconciled.has(record.order.number),
      })),
    ),
  );
}
