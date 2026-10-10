import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { maskPhone, normalisePhone } from "@siumora/core";

import type { Operator } from "./operator-gate";
import { loadCustomer, type CustomerRow } from "./customer-signin";
import { realEmail } from "./guest-email";

/**
 * Shared by the /admin/siumora/customers/:id routes (auth plan phase 3):
 * load the customer the URL names, and shape it for an operator — the
 * phone MASKED by default for everyone. Seeing the whole number is its
 * own audited action (customers/:id/reveal), not a side effect of opening
 * the page.
 */

export async function customerFromParams(
  req: MedusaRequest,
  res: MedusaResponse,
): Promise<CustomerRow | undefined> {
  const id = String(req.params.id ?? "");
  if (!/^cus_[A-Za-z0-9]{10,40}$/.test(id)) {
    res.status(400).json({ error: "invalid_request", message: "Expected a customer id." });
    return undefined;
  }
  const customer = await loadCustomer(req, id);
  if (!customer) {
    res.status(404).json({ error: "not_found", message: "No such customer." });
    return undefined;
  }
  return customer;
}

export function operatorCustomerCard(customer: CustomerRow & { created_at?: unknown }) {
  const phone = normalisePhone(customer.phone ?? "") as string | undefined;
  return {
    id: customer.id,
    name: [customer.first_name ?? "", customer.last_name ?? ""].join(" ").trim(),
    maskedPhone: phone ? maskPhone(phone) : null,
    email: realEmail(customer.email),
    hasAccount: customer.has_account !== false,
  };
}

/** What the operator may do on this card, for the widget to render against. */
export function customerAbilities(operator: Operator) {
  return {
    revokeSessions: operator.permissions.includes("customers:sessions"),
    admin: operator.permissions.includes("customers:admin"),
  };
}
