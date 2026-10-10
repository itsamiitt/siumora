/**
 * POST /store/siumora/me/email { email } — change the account's email
 * (security review: Medusa 2.21's own profile route has no email field, and
 * a stolen session must not be able to redirect receipts and verification
 * links). Behind the StepUpGate. The new address starts unverified — the
 * verified mark names the address it was earned for.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { ICustomerModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

import { requireStepUp } from "../../../../../lib/customer-guard";
import { customerCard, loadCustomer, verifiedPhone } from "../../../../../lib/customer-signin";
import { isGuestEmail } from "../../../../../lib/guest-email";

/** Deliberately plain: a mailbox, a domain with a dot, no spaces. */
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const session = requireStepUp(req, res);
  if (!session) return;

  const raw = (req.body as { email?: unknown } | undefined)?.email;
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 200 || isGuestEmail(email)) {
    res.status(400).json({ error: "invalid_email", message: "Enter a valid email address." });
    return;
  }

  const customers = req.scope.resolve<ICustomerModuleService>(Modules.CUSTOMER);
  try {
    await customers.updateCustomers(session.customerId, { email });
  } catch {
    // Another account already uses it (Medusa keeps registered emails
    // unique). Said plainly to the signed-in, stepped-up holder only.
    res.status(409).json({ error: "email_in_use", message: "That email is already on another account." });
    return;
  }

  const customer = await loadCustomer(req, session.customerId);
  const phone = (customer && (await verifiedPhone(req, session.customerId, customer))) ?? "";
  res.json({
    ok: true,
    customer: customer ? customerCard(customer, phone) : null,
  });
}
