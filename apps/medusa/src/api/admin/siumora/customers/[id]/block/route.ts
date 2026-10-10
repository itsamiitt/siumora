import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { customerFromParams } from "../../../../../../lib/admin-customer";
import { pgOf } from "../../../../../../lib/customer-signin";
import { auditAction, requireOperator } from "../../../../../../lib/operator-gate";
import { revokeAllSessions, setBlocked } from "../../../../../../modules/customer-session/data";

/**
 * POST /admin/siumora/customers/:id/block { reason } — stop an account
 * signing in (auth plan phase 3): fraud, an abusive COD pattern, a takeover
 * in progress. Every session ends now and the next sign-in is refused with
 * a message pointing at the grievance desk. Ops lead (customers:admin),
 * with a reason that the audit log keeps.
 */
export const AUTHENTICATE = false;

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "customers:admin");
  if (!operator) return;
  const customer = await customerFromParams(req, res);
  if (!customer) return;

  const raw = (req.body as { reason?: unknown } | undefined)?.reason;
  const reason = typeof raw === "string" ? raw.trim().slice(0, 500) : "";
  if (reason.length < 3) {
    res.status(400).json({ error: "invalid_request", message: "Say why — the reason is kept in the audit log." });
    return;
  }

  const now = new Date();
  await setBlocked(pgOf(req), {
    customerId: customer.id,
    blocked: true,
    reason,
    by: operator.contact,
    now,
  });
  const revoked = await revokeAllSessions(pgOf(req), { customerId: customer.id, reason: "blocked", now });
  await auditAction(req, operator, "customer.block", { subject: customer.id, detail: { reason, revoked } });
  res.json({ ok: true, revoked });
}
