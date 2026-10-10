import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { customerFromParams } from "../../../../../../lib/admin-customer";
import { pgOf } from "../../../../../../lib/customer-signin";
import { auditAction, requireOperator } from "../../../../../../lib/operator-gate";
import { revokeAllSessions, revokeSessionById } from "../../../../../../modules/customer-session/data";

/**
 * POST /admin/siumora/customers/:id/revoke-sessions { sessionId? } — the
 * lost-phone call (auth plan phase 3): sign one device out, or every device
 * when no session id is given. Support and above (customers:sessions).
 * Audited either way.
 */
export const AUTHENTICATE = false;

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "customers:sessions");
  if (!operator) return;
  const customer = await customerFromParams(req, res);
  if (!customer) return;

  const raw = (req.body as { sessionId?: unknown } | undefined)?.sessionId;
  const sessionId = typeof raw === "string" && raw ? raw : undefined;
  const now = new Date();
  const revoked = sessionId
    ? await revokeSessionById(pgOf(req), {
        id: sessionId,
        customerId: customer.id,
        reason: "revoked_by_operator",
        now,
      })
    : await revokeAllSessions(pgOf(req), { customerId: customer.id, reason: "revoked_by_operator", now });

  await auditAction(req, operator, "customer.revoke_sessions", {
    subject: customer.id,
    detail: { revoked, ...(sessionId ? { sessionId } : { all: true }) },
  });
  res.json({ ok: true, revoked });
}
