import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { auditAction, requireOperator } from "../../../../lib/operator-gate";
import { parsePincodeCsv } from "../../../../modules/serviceability/import";
import {
  findPincode,
  importServiceability,
  summariseServiceability,
  type SqlClient,
} from "../../../../modules/serviceability/lookup";
import { isWellFormedPincode, pincodeCard } from "../../../../modules/serviceability/serviceability";

/**
 * The courier's pincode list, for the owner (plan 16 B25) — behind the
 * "Checkout & COD" card on the Store page.
 *
 * GET → the summary (how many pincodes, how many with COD, last update),
 *   or with ?pincode= the one card exactly as the storefront sees it.
 * POST {csv, dryRun} → check the whole file, then report (dry run) or
 *   upsert. Owner only (settings:write); a real import is audited.
 */
export const AUTHENTICATE = false;

function pg(req: MedusaRequest): SqlClient {
  return req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlClient;
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "settings:write");
  if (!operator) return;

  res.setHeader("Cache-Control", "no-store");
  const pincode = typeof req.query.pincode === "string" ? req.query.pincode.trim() : undefined;
  if (pincode !== undefined) {
    if (!isWellFormedPincode(pincode)) {
      res.status(400).json({ error: "invalid_request", message: "Enter a six-digit pincode." });
      return;
    }
    res.json({ card: pincodeCard(pincode, await findPincode(pg(req), pincode)) });
    return;
  }
  res.json({ summary: await summariseServiceability(pg(req)) });
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "settings:write");
  if (!operator) return;

  const body = (req.body ?? {}) as { csv?: unknown; dryRun?: unknown };
  if (typeof body.csv !== "string") {
    res.status(400).json({ error: "invalid_request", message: "csv: expected the file's text" });
    return;
  }
  const parsed = parsePincodeCsv(body.csv);
  if (!parsed.ok) {
    res.status(400).json({ error: "invalid_file", message: parsed.errors[0], errors: parsed.errors });
    return;
  }

  const dryRun = body.dryRun !== false;
  const outcome = await importServiceability(pg(req), parsed.rows, { dryRun });
  if (!dryRun) {
    await auditAction(req, operator, "serviceability.import", {
      subject: `${parsed.rows.length} pincodes`,
      detail: outcome,
    });
  }
  res.json({ dryRun, rows: parsed.rows.length, ...outcome, summary: await summariseServiceability(pg(req)) });
}
