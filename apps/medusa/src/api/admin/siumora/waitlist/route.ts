import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { requireOperator } from "../../../../lib/operator-gate";
import { listWaitlist, type SqlClient } from "../../../../modules/waitlist/data";

export const AUTHENTICATE = false;

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "audit:read");
  if (!operator) return;

  const raw = req.query.page;
  const page = raw === undefined ? 0 : typeof raw === "string" && /^\d{1,6}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(page) || page > 100000) {
    res.status(400).json({ error: "invalid_request", message: "page must be a non-negative integer." });
    return;
  }

  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlClient;
  const result = await listWaitlist(pg, page);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(result);
}
