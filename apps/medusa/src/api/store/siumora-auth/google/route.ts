/**
 * POST /store/siumora-auth/google — finish a Google sign-in (auth plan
 * phase 4), with safe linking.
 *
 * The storefront has already been through Google and Medusa's own Google
 * provider (/auth/customer/google and its callback), which leaves it a
 * short Medusa JWT for the Google identity; it sends that here as the
 * bearer. Then:
 *
 * - the Google account is already linked to a customer → a session opens,
 *   exactly as after a phone OTP (same envelope as /verify);
 * - it is not → nothing opens. Google proves an email address, and on this
 *   site the account IS the phone, so a Google account never attaches
 *   itself to anyone by matching an email. The answer is
 *   { needsPhone: true, linkToken }: the storefront keeps the 10-minute
 *   token in an HTTP-only cookie, the shopper verifies their phone with an
 *   OTP, and /verify links the Google account to that phone's customer.
 *
 * Refused while google_signin_enabled is off.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getAuthContextFromJwtToken } from "@medusajs/framework/http";
import type { IAuthModuleService } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

import {
  customerCard,
  isBlocked,
  loadCustomer,
  logAuthEvent,
  openSession,
  pgOf,
  sessionKindFor,
  verifiedPhone,
} from "../../../../lib/customer-signin";
import { issueToken, tokenSecret } from "../../../../lib/signed-token";
import { settingsCache } from "../../../../modules/settings/cache";
import { readSettings, type SqlClient as SettingsSqlClient } from "../../../../modules/settings/read";

export const GOOGLE_LINK_TTL_SECONDS = 600;

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const settings = await settingsCache(() =>
    readSettings(pgOf(req) as unknown as SettingsSqlClient),
  ).get();
  if (!settings.googleSignInEnabled) {
    res.status(403).json({ error: "google_disabled", message: "Google sign-in is not available." });
    return;
  }

  const { http } = req.scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE).projectConfig;
  const context = getAuthContextFromJwtToken(
    req.headers.authorization,
    http.jwtSecret as string,
    ["bearer"],
    ["customer"],
    http.jwtPublicKey,
    http.jwtVerifyOptions ?? http.jwtOptions,
  ) as { auth_identity_id?: string; auth_provider?: string } | null;
  if (!context?.auth_identity_id || context.auth_provider !== "google") {
    res.status(401).json({ error: "google_failed", message: "Google sign-in did not complete. Try again." });
    return;
  }

  const auth = req.scope.resolve<IAuthModuleService>(Modules.AUTH);
  const identity = await auth.retrieveAuthIdentity(context.auth_identity_id, {
    relations: ["provider_identities"],
  });
  const customerId = identity.app_metadata?.customer_id;

  if (typeof customerId !== "string" || !customerId) {
    // Named (masked) on the link step so the shopper can see WHICH Google
    // account they are about to attach to their phone.
    const google = identity.provider_identities?.find((entry) => entry.provider === "google");
    const email = typeof google?.user_metadata?.email === "string" ? google.user_metadata.email : "";
    const at = email.indexOf("@");
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      needsPhone: true,
      ...(at > 0 ? { googleEmail: `${email.slice(0, 1)}…${email.slice(at)}` } : {}),
      linkToken: issueToken(
        "google_link",
        { authIdentityId: identity.id },
        GOOGLE_LINK_TTL_SECONDS,
        tokenSecret(),
      ),
    });
    return;
  }

  const customer = await loadCustomer(req, customerId);
  const phone = customer ? await verifiedPhone(req, customerId, customer) : undefined;
  if (!customer || !phone) {
    // Linked to an account that has since lost its phone (erased, merged
    // away): treat as unlinked rather than open a phoneless session.
    res.status(409).json({ error: "google_unlinked", message: "Sign in with your phone number." });
    return;
  }
  if (sessionKindFor(phone) === "operator") {
    // Operator sessions read every customer's address: they start from an
    // OTP on the listed number, never from a Google account.
    res.status(403).json({ error: "use_phone", message: "Operators sign in with their phone number." });
    return;
  }
  if (await isBlocked(req, customerId)) {
    await logAuthEvent(req, { type: "signin_blocked", customerId, channel: "google" }, phone);
    res.status(403).json({
      error: "account_blocked",
      message: "This account can't sign in right now. Contact us at the grievance desk.",
    });
    return;
  }

  // stepUp false: Google proves an email, not the phone — phone and email
  // changes, erasure and large COD still ask for a fresh code.
  const session = await openSession(req, { customerId, authIdentityId: identity.id, phone, stepUp: false });
  await logAuthEvent(
    req,
    { type: "signin_completed", customerId, channel: "google", detail: { kind: session.kind } },
    phone,
  );
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt.toISOString(),
    isAdmin: session.kind === "operator",
    claimedOrders: 0,
    customer: customerCard(customer, phone),
  });
}
