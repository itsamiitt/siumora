/**
 * POST /store/siumora-auth/step-up — re-prove the phone for a sensitive
 * action (the storefront's StepUpGate). The customer asks for a code on
 * their own number through /store/siumora-auth/otp as usual, then sends it
 * here; a match stamps this session's step_up_at, and sensitive routes
 * accept it for STEP_UP_WINDOW_SECONDS (10 minutes).
 *
 * The phone is the account's stored phone, never a body field: a step-up
 * proves the account holder is present, so it cannot be done with someone
 * else's number.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IAuthModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { normalisePhone } from "@siumora/core";

import { loadCustomer, logAuthEvent, pgOf } from "../../../../lib/customer-signin";
import { otpFailure } from "../../../../lib/otp-verdict";
import { currentSession } from "../../../../lib/session-auth";
import { markStepUp } from "../../../../modules/customer-session/data";
import { STEP_UP_WINDOW_SECONDS } from "../../../../modules/customer-session/session";
import type { PhoneOtpAuthenticationResponse } from "../../../../modules/phone-auth/service";

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const session = currentSession(req);
  if (!session) {
    res.status(401).json({ error: "not_signed_in", message: "Sign in to continue." });
    return;
  }
  const customer = await loadCustomer(req, session.customerId);
  const phone = normalisePhone(customer?.phone ?? "");
  if (!phone) {
    res.status(409).json({ error: "no_phone", message: "This account has no phone number to verify." });
    return;
  }

  const raw = typeof req.body === "object" && req.body ? (req.body as { code?: unknown }).code : undefined;
  const code = typeof raw === "string" ? raw.trim() : "";
  // An empty code would make the provider issue (and send) a new challenge;
  // this route only ever judges one.
  if (code === "") {
    res.status(400).json({ error: "invalid_code", message: "Enter the 6-digit code." });
    return;
  }

  const auth = req.scope.resolve<IAuthModuleService>(Modules.AUTH);
  const result = (await auth.authenticate("phone-otp", {
    url: req.url,
    headers: req.headers as Record<string, string>,
    query: {},
    body: { phone, code },
    protocol: req.protocol,
  })) as PhoneOtpAuthenticationResponse;

  if (!result.success || !result.authIdentity) {
    await logAuthEvent(req, { type: "otp_failed", customerId: session.customerId, detail: { stepUp: true } }, phone);
    const failure = otpFailure(result);
    res.status(failure.status).json(failure.body);
    return;
  }

  const now = new Date();
  await markStepUp(pgOf(req), session.id, now);
  await logAuthEvent(req, { type: "step_up", customerId: session.customerId }, phone);
  res.json({
    ok: true,
    stepUpExpiresAt: new Date(now.getTime() + STEP_UP_WINDOW_SECONDS * 1000).toISOString(),
  });
}
