/**
 * GET /store/siumora-auth/session — who is signed in (the Fastify
 * /auth/session envelope). Anonymous is a normal answer, not an error.
 *
 * `isAdmin` is read from ADMIN_PHONES on every call, never stored, so taking
 * a number off the list takes effect on the next request. `session` carries
 * what the storefront needs for the StepUpGate: whether the last OTP on this
 * session is fresh enough for a sensitive action.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { normalisePhone } from "@siumora/core";

import { customerCard, loadCustomer, sessionKindFor, verifiedPhone } from "../../../../lib/customer-signin";
import { currentSession } from "../../../../lib/session-auth";
import { STEP_UP_WINDOW_SECONDS, stepUpFresh } from "../../../../modules/customer-session/session";

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  const session = currentSession(req);
  if (!session) {
    res.json({ signedIn: false });
    return;
  }

  const customer = await loadCustomer(req, session.customerId);
  if (!customer) {
    res.json({ signedIn: false });
    return;
  }
  const phone = normalisePhone(customer.phone ?? "") ?? customer.phone ?? "";
  const now = new Date();
  res.json({
    signedIn: true,
    // Operator status from the VERIFIED number only (security review).
    isAdmin: (await verifiedPhone(req, session.customerId, customer)) !== undefined && sessionKindFor(phone) === "operator",
    customer: customerCard(customer, phone),
    session: {
      id: session.id,
      stepUpFresh: stepUpFresh(session.stepUpAt, now),
      stepUpExpiresAt: session.stepUpAt
        ? new Date(session.stepUpAt.getTime() + STEP_UP_WINDOW_SECONDS * 1000).toISOString()
        : null,
    },
  });
}
