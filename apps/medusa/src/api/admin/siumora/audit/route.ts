import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { isAuditAction } from "@siumora/core";

import { requireOperator } from "../../../../lib/operator-gate";
import { auditEntry } from "../../../../modules/audit/audit";
import { readAudit, type SqlClient } from "../../../../modules/audit/data";

/**
 * GET /admin/siumora/audit — the audit log, ported from
 * apps/api/src/routes/admin.ts. Owner only (audit:read), and readable rather
 * than exportable: somebody who can rewrite history is somebody the log
 * cannot testify against, so the route offers no way to change it.
 *
 * Every entry's actor contact is masked at the read (module audit.ts) —
 * full contacts are in the table for accountability; a screen anybody can
 * shoulder-surf does not need them.
 */
export const AUTHENTICATE = false;

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "audit:read");
  if (!operator) return;

  const rawAction = req.query.action;
  const rawSubject = req.query.subject;
  const action =
    typeof rawAction === "string" && isAuditAction(rawAction) ? rawAction : undefined;
  const subject = typeof rawSubject === "string" ? rawSubject : undefined;

  const pg = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as SqlClient;
  const entries = await readAudit(pg, {
    ...(action ? { action } : {}),
    ...(subject ? { subject } : {}),
  });

  res.setHeader("Cache-Control", "no-store");
  res.json({ entries: entries.map(auditEntry) });
}
