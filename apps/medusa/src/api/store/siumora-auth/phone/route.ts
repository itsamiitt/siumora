/**
 * POST /store/siumora-auth/phone { phone, code } — move the account to a new
 * mobile number (auth plan phase 2).
 *
 * Two proofs, because the phone IS the account:
 * 1. the StepUpGate — a fresh code on the CURRENT number (the account holder
 *    is present, not just a session), and
 * 2. a code sent to the NEW number through /store/siumora-auth/otp as usual
 *    (the new number is really theirs), judged here.
 *
 * A number that already signs in to another account is refused (409): two
 * accounts cannot share a phone, and silently moving one into the other is
 * an operator's merge, not a self-service action. On success the new
 * number signs in to this account, the old one no longer does, every other
 * device is signed out, and the OLD number gets a WhatsApp notice — the one
 * phone that can still raise the alarm if this was not its owner.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type {
  IAuthModuleService,
  ICustomerModuleService,
} from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { setAuthAppMetadataWorkflow } from "@medusajs/medusa/core-flows";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { maskPhone, normalisePhone } from "@siumora/core";

import { requireStepUp } from "../../../../lib/customer-guard";
import { loadCustomer, logAuthEvent, pgOf } from "../../../../lib/customer-signin";
import { guestEmail, isGuestEmail } from "../../../../lib/guest-email";
import { otpFailure } from "../../../../lib/otp-verdict";
import { phoneChangedMessage, sendSecurityAlert } from "../../../../lib/security-alert";
import { revokeAllSessions } from "../../../../modules/customer-session/data";
import type { PhoneOtpAuthenticationResponse } from "../../../../modules/phone-auth/service";

async function identityIdFor(auth: IAuthModuleService, phone: string): Promise<string | undefined> {
  const providers = await auth.listProviderIdentities({ entity_id: phone, provider: "phone-otp" });
  return providers[0]?.auth_identity_id ?? undefined;
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const session = requireStepUp(req, res);
  if (!session) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const newPhone = normalisePhone(typeof body.phone === "string" ? body.phone : "") as string | undefined;
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!newPhone) {
    res.status(400).json({ error: "invalid_phone", message: "Enter a 10-digit Indian mobile number." });
    return;
  }
  if (code === "") {
    res.status(400).json({ error: "invalid_code", message: "Enter the 6-digit code." });
    return;
  }

  const customer = await loadCustomer(req, session.customerId);
  const oldPhone = normalisePhone(customer?.phone ?? "") as string | undefined;
  if (oldPhone === newPhone) {
    res.status(400).json({ error: "same_phone", message: "That is already your number." });
    return;
  }

  const auth = req.scope.resolve<IAuthModuleService>(Modules.AUTH);
  const existingId = await identityIdFor(auth, newPhone);
  if (existingId) {
    const existing = await auth.retrieveAuthIdentity(existingId);
    const owner = existing.app_metadata?.customer_id;
    if (typeof owner === "string" && owner && owner !== session.customerId) {
      res.status(409).json({
        error: "phone_in_use",
        message: "That number already has its own Siumora account. Contact us to merge them.",
      });
      return;
    }
  }

  const result = (await auth.authenticate("phone-otp", {
    url: req.url,
    headers: req.headers as Record<string, string>,
    query: {},
    body: { phone: newPhone, code },
    protocol: req.protocol,
  })) as PhoneOtpAuthenticationResponse;
  if (!result.success || !result.authIdentity) {
    await logAuthEvent(req, { type: "otp_failed", customerId: session.customerId, detail: { phoneChange: true } }, newPhone);
    const failure = otpFailure(result);
    res.status(failure.status).json(failure.body);
    return;
  }

  // The new number signs in to this account…
  const newIdentity = result.authIdentity;
  if (newIdentity.app_metadata?.customer_id !== session.customerId) {
    await setAuthAppMetadataWorkflow(req.scope).run({
      input: { authIdentityId: newIdentity.id, actorType: "customer", value: session.customerId },
    });
  }
  // …and the old one no longer does.
  if (oldPhone) {
    const oldIdentityId = await identityIdFor(auth, oldPhone);
    if (oldIdentityId && oldIdentityId !== newIdentity.id) {
      await setAuthAppMetadataWorkflow(req.scope).run({
        input: { authIdentityId: oldIdentityId, actorType: "customer", value: null },
      });
    }
  }

  const customers = req.scope.resolve<ICustomerModuleService>(Modules.CUSTOMER);
  await customers.updateCustomers(session.customerId, {
    phone: newPhone,
    // The derived placeholder follows the number; a real email stays.
    ...(customer?.email && !isGuestEmail(customer.email) ? {} : { email: guestEmail(newPhone) }),
  });

  const now = new Date();
  const revoked = await revokeAllSessions(pgOf(req), {
    customerId: session.customerId,
    reason: "reverify",
    now,
    exceptId: session.id,
  });
  await logAuthEvent(
    req,
    { type: "signin_completed", customerId: session.customerId, detail: { phoneChanged: true, revoked } },
    newPhone,
  );
  if (oldPhone) {
    void sendSecurityAlert(req, oldPhone, phoneChangedMessage(maskPhone(newPhone), now), "security_phone_changed");
  }

  res.json({ ok: true, maskedPhone: maskPhone(newPhone), signedOutDevices: revoked });
}
