import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { customerFromParams } from "../../../../../../lib/admin-customer";
import { pgOf } from "../../../../../../lib/customer-signin";
import { auditAction, requireOperator } from "../../../../../../lib/operator-gate";
import { setBlocked } from "../../../../../../modules/customer-session/data";

/** POST /admin/siumora/customers/:id/unblock — let the account sign in again. */
export const AUTHENTICATE = false;

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "customers:admin");
  if (!operator) return;
  const customer = await customerFromParams(req, res);
  if (!customer) return;

  await setBlocked(pgOf(req), {
    customerId: customer.id,
    blocked: false,
    by: operator.contact,
    now: new Date(),
  });
  await auditAction(req, operator, "customer.unblock", { subject: customer.id });
  res.json({ ok: true });
}
