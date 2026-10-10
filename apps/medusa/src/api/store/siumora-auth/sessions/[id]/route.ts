/**
 * DELETE /store/siumora-auth/sessions/:id — sign one device out. Scoped to
 * the caller's own sessions in the SQL itself, so an id belonging to anyone
 * else simply matches nothing (404, never a hint that it exists).
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { logAuthEvent, pgOf } from "../../../../../lib/customer-signin";
import { currentSession } from "../../../../../lib/session-auth";
import { revokeSessionById } from "../../../../../modules/customer-session/data";

export async function DELETE(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const session = currentSession(req);
  if (!session) {
    res.status(401).json({ error: "not_signed_in", message: "Sign in to continue." });
    return;
  }
  const id = String(req.params.id ?? "");
  const revoked = await revokeSessionById(pgOf(req), {
    id,
    customerId: session.customerId,
    reason: "revoked_by_customer",
    now: new Date(),
  });
  if (revoked === 0) {
    res.status(404).json({ error: "not_found", message: "That session is not active." });
    return;
  }
  await logAuthEvent(req, { type: "session_revoked", customerId: session.customerId, detail: { sessionId: id } });
  res.json({ ok: true, current: id === session.id });
}
