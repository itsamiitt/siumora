/**
 * POST /store/siumora-auth/signout-everywhere — revoke every session this
 * customer holds, this one included: what someone does after losing a
 * phone. Answers { ok, revoked } like the Fastify route.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { logAuthEvent, pgOf } from "../../../../lib/customer-signin";
import { currentSession } from "../../../../lib/session-auth";
import { revokeAllSessions } from "../../../../modules/customer-session/data";

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const session = currentSession(req);
  if (!session) {
    res.status(401).json({ error: "not_signed_in", message: "Sign in to continue." });
    return;
  }
  const revoked = await revokeAllSessions(pgOf(req), {
    customerId: session.customerId,
    reason: "signout_everywhere",
    now: new Date(),
  });
  await logAuthEvent(req, { type: "signout_everywhere", customerId: session.customerId, detail: { revoked } });
  res.json({ ok: true, revoked });
}
