import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { requireOperator } from "../../../../lib/operator-gate";
import type { SqlClient } from "../../../../modules/customer-session/data";
import { openPrivacyQueue } from "../../../../modules/customer-session/privacy";

/**
 * GET /admin/siumora/privacy-requests — the open data-principal requests,
 * oldest deadline first (plan 16 B27, the Fastify /admin/privacy-requests).
 * Mostly erasures the customer path could not finish because a parcel was
 * still moving; an operator completes them from here once it lands.
 */
export const AUTHENTICATE = false;

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "privacy:write");
  if (!operator) return;

  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlClient;
  const now = Date.now();
  const rows = await openPrivacyQueue(pg);

  res.setHeader("Cache-Control", "no-store");
  res.json({
    requests: rows.map((row) => ({
      id: row.id,
      customerId: row.customer_id,
      kind: row.kind,
      status: row.status,
      note: row.note,
      resolveBy: new Date(row.resolve_by).toISOString(),
      overdue: new Date(row.resolve_by).getTime() < now,
      createdAt: new Date(row.created_at).toISOString(),
    })),
  });
}
