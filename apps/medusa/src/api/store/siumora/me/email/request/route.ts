/**
 * POST /store/siumora/me/email/request — send a verification link to the
 * account's email (auth plan phase 4). Three a day per account, and only
 * for a real address (not the phone-derived placeholder).
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { ICustomerModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

// prettier-ignore -- single line so @ts-ignore reaches the specifier
// @ts-ignore -- TS1479 until @siumora/messaging ships require-condition types
import { createTransport, type TransportEnv } from "@siumora/messaging";

import { underCap } from "../../../../../../lib/counters";
import { requireSession } from "../../../../../../lib/customer-guard";
import {
  EMAIL_TOKEN_TTL_SECONDS,
  emailVerified,
  verificationLink,
  verificationMessage,
} from "../../../../../../lib/email-verification";
import { isGuestEmail } from "../../../../../../lib/guest-email";
import { sharedCounters } from "../../../../../../lib/redis";
import { issueToken, tokenSecret } from "../../../../../../lib/signed-token";

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const session = requireSession(req, res);
  if (!session) return;

  const customers = req.scope.resolve<ICustomerModuleService>(Modules.CUSTOMER);
  const customer = await customers.retrieveCustomer(session.customerId, { select: ["id", "email", "metadata"] });
  if (!customer.email || isGuestEmail(customer.email)) {
    res.status(409).json({ error: "no_email", message: "Add an email address to your profile first." });
    return;
  }
  if (emailVerified(customer.email, customer.metadata)) {
    res.json({ ok: true, alreadyVerified: true });
    return;
  }

  const transport = createTransport(process.env as TransportEnv);
  if (!transport.channels.includes("email")) {
    res.status(503).json({ error: "email_unavailable", message: "Email is not connected yet. Try again later." });
    return;
  }
  const cap = await underCap(sharedCounters(), `email-verify:${customer.id}`, 3, 86_400_000);
  if (!cap.allowed) {
    res.header("Retry-After", String(cap.retryAfterSeconds));
    res.status(429).json({ error: "rate_limited", message: "We have sent a few links already. Check your inbox.", retryAfterSeconds: cap.retryAfterSeconds });
    return;
  }

  const token = issueToken(
    "email_verify",
    { customerId: customer.id, email: customer.email },
    EMAIL_TOKEN_TTL_SECONDS,
    tokenSecret(),
  );
  const link = verificationLink(process.env.STOREFRONT_URL ?? "http://localhost:3000", token);
  const outcome = (await transport.send("email", customer.email, verificationMessage(link), {
    templateKey: "email_verify",
  })) as { kind: string; error?: string };
  if (outcome.kind !== "sent") {
    res.status(502).json({ error: "send_failed", message: "Could not send the email just now. Try again shortly." });
    return;
  }
  res.json({ ok: true, alreadyVerified: false });
}
