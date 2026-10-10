import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { stepUpFresh } from "../modules/customer-session/session.ts";
import { currentSession, type SiumoraSessionContext } from "./session-auth.ts";

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

/** What a customer may change through Medusa's own POST /store/customers/me. */
export const SELF_EDITABLE_FIELDS = new Set(["first_name", "last_name", "company_name"]);

/**
 * Middleware on Medusa's own POST /store/customers/me (security review).
 * Medusa 2.21 lets a customer set their own `phone` and `metadata` there —
 * and the phone is the account: it decides the operator role, where step-up
 * codes go, which guest orders are claimable. So this route takes names
 * only; the phone changes through /store/siumora-auth/phone (two OTPs) and
 * the email through /store/siumora/me/email (step-up).
 */
export function restrictSelfUpdate(
  req: MedusaRequest,
  res: MedusaResponse,
  next: (error?: unknown) => void,
): void {
  if (req.method !== "POST") return next();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const refused = Object.keys(body).filter((key) => !SELF_EDITABLE_FIELDS.has(key));
  if (refused.length > 0) {
    res.status(400).json({
      error: "field_not_editable",
      message: `These can't be changed here: ${refused.join(", ")}.`,
    });
    return;
  }
  next();
}
