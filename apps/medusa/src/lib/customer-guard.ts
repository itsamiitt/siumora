import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { stepUpFresh } from "../modules/customer-session/session";
import { loadCustomer } from "./customer-signin";
import { currentSession, type SiumoraSessionContext } from "./session-auth";

/**
 * The two gates customer routes use: signed in at all, and signed in with a
 * fresh OTP (the StepUpGate — auth plan phase 2) for actions where a stolen
 * session must not be enough: changing the phone or email, erasing the
 * account, a large COD order to a new address.
 */

export function requireSession(
  req: MedusaRequest,
  res: MedusaResponse,
): SiumoraSessionContext | undefined {
  const session = currentSession(req);
  if (!session) {
    res.status(401).json({ error: "not_signed_in", message: "Sign in to continue." });
    return undefined;
  }
  return session;
}

export const STEP_UP_REFUSAL = {
  error: "step_up_required",
  message: "For your security, confirm it's you with a fresh code.",
} as const;

export function requireStepUp(
  req: MedusaRequest,
  res: MedusaResponse,
): SiumoraSessionContext | undefined {
  const session = requireSession(req, res);
  if (!session) return undefined;
  if (!stepUpFresh(session.stepUpAt, new Date())) {
    res.status(403).json(STEP_UP_REFUSAL);
    return undefined;
  }
  return session;
}

/**
 * Middleware on Medusa's own POST /store/customers/me: changing the email
 * (where receipts and, in phase 4, verification links go) needs a fresh
 * code. A name change alone does not.
 */
export async function emailChangeNeedsStepUp(
  req: MedusaRequest,
  res: MedusaResponse,
  next: (error?: unknown) => void,
): Promise<void> {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  const session = currentSession(req);
  if (req.method !== "POST" || email === undefined || !session) return next();

  const customer = await loadCustomer(req, session.customerId);
  const unchanged =
    typeof email === "string" &&
    email.trim().toLowerCase() === (customer?.email ?? "").toLowerCase();
  if (unchanged || stepUpFresh(session.stepUpAt, new Date())) return next();

  res.status(403).json(STEP_UP_REFUSAL);
}
