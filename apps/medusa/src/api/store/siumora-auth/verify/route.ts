/**
 * POST /store/siumora-auth/verify — exchange a code for a session.
 *
 * Also (phase 2): a WhatsApp alert when the device is new to the account,
 * and `claimableOrders` — guest orders on this phone the account page will
 * offer with "Is this your order?".
 *
 * One request instead of the old three-call dance (built-in auth route →
 * create customer → refresh token): the phone-otp provider judges the code,
 * the customer is found or created for the verified phone, and a revocable
 * session (customer-session module) is opened. The answer is the Fastify
 * /auth/verify envelope, so the SDK serves both backends alike:
 *
 *   200 { ok, token, expiresAt, isAdmin, claimedOrders, customer }
 *
 * `token` is the opaque `sst_` session token — the storefront keeps it in
 * its HTTP-only cookie and every later request resolves it in
 * lib/session-auth.ts. Failures mirror Fastify: 401 wrong_code, 410
 * code_unusable, 403 account_blocked for a customer an operator blocked.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IAuthModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { normalisePhone } from "@siumora/core";

import {
  customerCard,
  ensureCustomer,
  isBlocked,
  loadCustomer,
  logAuthEvent,
  openSession,
  pgOf,
} from "../../../../lib/customer-signin";
import { claimableIdentities } from "../../../../lib/claimable";
import { linkGoogleIdentity } from "../../../../lib/google-link";
import { withinGuessCap } from "../../../../lib/guess-cap";
import { otpFailure } from "../../../../lib/otp-verdict";
import { newDeviceMessage, sendSecurityAlert } from "../../../../lib/security-alert";
import { settingsCache } from "../../../../modules/settings/cache";
import { readSettings, type SqlClient as SettingsSqlClient } from "../../../../modules/settings/read";
import type { PhoneOtpAuthenticationResponse } from "../../../../modules/phone-auth/service";

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawPhone = typeof body.phone === "string" ? body.phone.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const phone = rawPhone.length <= 20 ? normalisePhone(rawPhone) : undefined;
  if (!phone) {
    res.status(400).json({ error: "invalid_phone", message: "Enter a 10-digit Indian mobile number." });
    return;
  }

  // An empty code would make the provider ISSUE a challenge (and send a
  // message) instead of judging one — past every cap the /otp route holds.
  if (code === "") {
    res.status(400).json({ error: "invalid_code", message: "Enter the 6-digit code." });
    return;
  }

  if (!(await withinGuessCap(req, res, phone))) return;

  const auth = req.scope.resolve<IAuthModuleService>(Modules.AUTH);
  const result = (await auth.authenticate("phone-otp", {
    url: "/store/siumora-auth/verify",
    headers: req.headers as Record<string, string>,
    query: {},
    body: { phone, code },
    protocol: req.protocol,
  })) as PhoneOtpAuthenticationResponse;

  if (!result.success || !result.authIdentity) {
    await logAuthEvent(req, { type: "otp_failed", detail: { reason: result.errorCode ?? "error" } }, phone);
    const failure = otpFailure(result);
    res.status(failure.status).json(failure.body);
    return;
  }

  const identity = result.authIdentity;
  const customerId = await ensureCustomer(req, identity, phone);
  await logAuthEvent(req, { type: "otp_verified", customerId }, phone);

  if (await isBlocked(req, customerId)) {
    await logAuthEvent(req, { type: "signin_blocked", customerId }, phone);
    res.status(403).json({
      error: "account_blocked",
      message: "This account can't sign in right now. Contact us at the grievance desk.",
    });
    return;
  }

  // A Google sign-in waiting on this phone (phase 4): the OTP just proved
  // the number, so the Google account links to its customer now.
  if (body.googleLinkToken !== undefined && (await linkGoogleIdentity(req, body.googleLinkToken, customerId, phone))) {
    await logAuthEvent(req, { type: "google_linked", customerId, channel: "google" }, phone);
  }

  const session = await openSession(req, {
    customerId,
    authIdentityId: identity.id,
    phone,
  });
  await logAuthEvent(
    req,
    { type: "signin_completed", customerId, detail: { kind: session.kind, newDevice: session.newDevice } },
    phone,
  );

  // A device this account has not signed in from before: tell the account
  // holder on WhatsApp (auth plan phase 2). Not awaited past its bound.
  const settings = await settingsCache(() =>
    readSettings(pgOf(req) as unknown as SettingsSqlClient),
  ).get();
  if (session.newDevice && settings.newDeviceAlerts) {
    void sendSecurityAlert(req, phone, newDeviceMessage(session.device, new Date()), "security_new_device").then(
      async (sent) => {
        if (sent) await logAuthEvent(req, { type: "new_device_alert", customerId, channel: "whatsapp" }, phone);
      },
    );
  }

  // Guest orders on this phone waiting for "Is this your order?". Counted,
  // never attached: the account page asks.
  const claimable = await claimableIdentities(req, customerId).catch(() => []);

  const customer = await loadCustomer(req, customerId);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt.toISOString(),
    isAdmin: session.kind === "operator",
    // Fastify parity field: orders attached at sign-in. Always 0 here —
    // guest orders are offered (claimableOrders), not attached.
    claimedOrders: 0,
    claimableOrders: claimable.length,
    customer: customerCard(customer ?? { id: customerId, email: null, phone, first_name: null, last_name: null }, phone),
  });
}
