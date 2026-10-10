import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { normalisePhone } from "@siumora/core";

import { customerFromParams } from "../../../../../../lib/admin-customer";
import { auditAction, requireOperator } from "../../../../../../lib/operator-gate";

/**
 * POST /admin/siumora/customers/:id/reveal — the whole phone number, for
 * an ops lead who has to call the customer (auth plan phase 3). Never on
 * the card itself: every reveal is an audit entry (customer.view_pii)
 * naming who looked and at whom.
 */
export const AUTHENTICATE = false;

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "customers:admin");
  if (!operator) return;
  const customer = await customerFromParams(req, res);
  if (!customer) return;

  await auditAction(req, operator, "customer.view_pii", { subject: customer.id });
  res.setHeader("Cache-Control", "no-store");
  res.json({ phone: normalisePhone(customer.phone ?? "") ?? customer.phone ?? null });
}
