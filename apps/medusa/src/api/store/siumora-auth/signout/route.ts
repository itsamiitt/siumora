/**
 * POST /store/siumora-auth/signout — end this session. Idempotent: signing
 * out twice, or without a session, is a success (Fastify /auth/signout).
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { logAuthEvent, pgOf } from "../../../../lib/customer-signin";
import { currentSession } from "../../../../lib/session-auth";
import { revokeSessionByToken } from "../../../../modules/customer-session/data";

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const session = currentSession(req);
  if (session) {
    await revokeSessionByToken(pgOf(req), session.token, "signout", new Date());
    await logAuthEvent(req, { type: "signout", customerId: session.customerId });
  }
  res.json({ ok: true });
}
