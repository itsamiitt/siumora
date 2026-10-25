import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { requireOperator } from "../../../../lib/operator-gate";
import { outboxHealth, type SqlClient } from "../../../../modules/outbox/data";

/**
 * GET /admin/siumora/outbox — are messages and conversions going out
 * (plan 16 Phase G)? Counts by status, and the latest failures with the
 * provider's reason. A backlog of "pending" means the worker is not
 * running; a wall of "skipped" means a provider is not configured; "failed"
 * rows each need a look. Numbers only — no phone numbers leave this route.
 */
export const AUTHENTICATE = false;

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "metrics:read");
  if (!operator) return;

  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlClient;
  const [health, failures] = await Promise.all([
    outboxHealth(pg),
    pg.raw(
      `SELECT template_key AS "templateKey", last_error AS "error", updated_at AS "at"
         FROM siumora_notifications WHERE status = 'failed' AND deleted_at IS NULL
        ORDER BY updated_at DESC LIMIT 10`,
    ),
  ]);
  res.setHeader("Cache-Control", "no-store");
  res.json({ ...health, failures: failures.rows });
}
