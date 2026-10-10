import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { customerFromParams } from "../../../../../../lib/admin-customer";
import { pgOf } from "../../../../../../lib/customer-signin";
import { auditAction, requireOperator } from "../../../../../../lib/operator-gate";
import { revokeAllSessions } from "../../../../../../modules/customer-session/data";

/**
 * POST /admin/siumora/customers/:id/reverify — force the account to prove
 * its phone again (auth plan phase 3): every session ends, so the next visit
 * starts with a fresh OTP. For a suspected takeover where blocking would
 * punish the real owner. Ops lead (customers:admin), audited.
 */
export const AUTHENTICATE = false;

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "customers:admin");
  if (!operator) return;
  const customer = await customerFromParams(req, res);
  if (!customer) return;

  const revoked = await revokeAllSessions(pgOf(req), {
    customerId: customer.id,
    reason: "reverify",
    now: new Date(),
  });
  await auditAction(req, operator, "customer.reverify", { subject: customer.id, detail: { revoked } });
  res.json({ ok: true, revoked });
}
