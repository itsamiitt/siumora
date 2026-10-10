import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { customerAbilities, customerFromParams, operatorCustomerCard } from "../../../../../../lib/admin-customer";
import { pgOf } from "../../../../../../lib/customer-signin";
import { requireOperator } from "../../../../../../lib/operator-gate";
import { listSessions, readAuthEvents, readSecurity } from "../../../../../../modules/customer-session/data";

/**
 * GET /admin/siumora/customers/:id/security — the customer page widget's
 * card (auth plan phase 3): identity (phone masked), security state,
 * signed-in devices and the recent sign-in log, plus what this operator
 * may do about them. Support and above (customers:read).
 */
export const AUTHENTICATE = false;

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "customers:read");
  if (!operator) return;
  const customer = await customerFromParams(req, res);
  if (!customer) return;

  const pg = pgOf(req);
  const [security, sessions, events] = await Promise.all([
    readSecurity(pg, customer.id),
    listSessions(pg, customer.id, new Date()),
    readAuthEvents(pg, { customerId: customer.id, limit: 50 }),
  ]);

  res.setHeader("Cache-Control", "no-store");
  res.json({
    customer: operatorCustomerCard(customer),
    security,
    sessions: sessions.map((row) => ({
      id: row.id,
      device: row.device,
      network: row.ip,
      kind: row.kind,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
    })),
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      channel: event.channel,
      device: event.device,
      network: event.ip,
      detail: event.detail,
      at: event.created_at,
    })),
    can: customerAbilities(operator),
  });
}
