/**
 * GET /store/siumora-auth/sessions — the signed-in devices on this account,
 * most recently used first, the current one marked (account → Security).
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { pgOf } from "../../../../lib/customer-signin";
import { currentSession } from "../../../../lib/session-auth";
import { listSessions } from "../../../../modules/customer-session/data";
import { sessionView } from "../../../../modules/customer-session/session";

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const session = currentSession(req);
  if (!session) {
    res.status(401).json({ error: "not_signed_in", message: "Sign in to continue." });
    return;
  }
  const rows = await listSessions(pgOf(req), session.customerId, new Date());
  res.setHeader("Cache-Control", "no-store");
  res.json({ sessions: rows.map((row) => sessionView(row, session.id)) });
}
