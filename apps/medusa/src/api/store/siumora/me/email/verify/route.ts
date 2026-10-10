/**
 * POST /store/siumora/me/email/verify { token } — the link in the
 * verification email (auth plan phase 4). No session needed: the signed,
 * 24-hour token is the proof, and the link is often opened in a mail app's
 * browser that is signed in to nothing.
 *
 * Verifies only if the account's email is STILL the address the link was
 * sent to — a link for an address since replaced verifies nothing.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { ICustomerModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

import { logAuthEvent } from "../../../../../../lib/customer-signin";
import { VERIFIED_AT_KEY, VERIFIED_EMAIL_KEY } from "../../../../../../lib/email-verification";
import { readToken, tokenSecret } from "../../../../../../lib/signed-token";

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const token = (req.body as { token?: unknown } | undefined)?.token;
  const payload = readToken(token, "email_verify", tokenSecret());
  const customerId = typeof payload?.customerId === "string" ? payload.customerId : undefined;
  const email = typeof payload?.email === "string" ? payload.email : undefined;
  if (!customerId || !email) {
    res.status(410).json({ error: "link_unusable", message: "This link has expired or is not valid. Send a new one from your profile." });
    return;
  }

  const customers = req.scope.resolve<ICustomerModuleService>(Modules.CUSTOMER);
  const customer = await customers.retrieveCustomer(customerId, { select: ["id", "email", "metadata"] }).catch(() => undefined);
  if (!customer || (customer.email ?? "").toLowerCase() !== email.toLowerCase()) {
    res.status(410).json({ error: "link_unusable", message: "This link is for an email address the account no longer uses." });
    return;
  }

  await customers.updateCustomers(customerId, {
    metadata: {
      ...(customer.metadata ?? {}),
      [VERIFIED_EMAIL_KEY]: email,
      [VERIFIED_AT_KEY]: new Date().toISOString(),
    },
  });
  await logAuthEvent(req, { type: "email_verified", customerId, channel: "email" });
  res.json({ ok: true });
}
