import type { MedusaRequest } from "@medusajs/framework/http";
import type { IAuthModuleService, ICustomerModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { setAuthAppMetadataWorkflow } from "@medusajs/medusa/core-flows";

import { VERIFIED_AT_KEY, VERIFIED_EMAIL_KEY } from "./email-verification";
import { sessionKindFor } from "./customer-signin";
import { isGuestEmail } from "./guest-email";
import { readToken, tokenSecret } from "./signed-token";

/**
 * Link a pending Google sign-in to the customer whose phone was just
 * verified (auth plan phase 4). Called from /verify after the OTP passed.
 *
 * - The link token must be valid and unexpired (10 minutes), and the Google
 *   identity still unlinked — a race or a replay links nothing.
 * - The customer gets the Google identity id in metadata, so erasure and
 *   merges can find it.
 * - Google only returns verified emails; if the customer has only the
 *   derived placeholder, the Google email becomes theirs, marked verified.
 *
 * Returns whether a link was made. Never throws: the sign-in it rides on
 * has already succeeded.
 */
export async function linkGoogleIdentity(
  req: MedusaRequest,
  linkToken: unknown,
  customerId: string,
  phone: string,
): Promise<boolean> {
  // Operator accounts start from an OTP on a listed number, never Google.
  if (sessionKindFor(phone) === "operator") return false;
  const payload = readToken(linkToken, "google_link", tokenSecret());
  const authIdentityId = typeof payload?.authIdentityId === "string" ? payload.authIdentityId : undefined;
  if (!authIdentityId) return false;

  try {
    const auth = req.scope.resolve<IAuthModuleService>(Modules.AUTH);
    const identity = await auth.retrieveAuthIdentity(authIdentityId, { relations: ["provider_identities"] });
    const google = identity.provider_identities?.find((entry) => entry.provider === "google");
    if (!google || identity.app_metadata?.customer_id) return false;

    await setAuthAppMetadataWorkflow(req.scope).run({
      input: { authIdentityId, actorType: "customer", value: customerId },
    });

    const customers = req.scope.resolve<ICustomerModuleService>(Modules.CUSTOMER);
    const customer = await customers.retrieveCustomer(customerId, { select: ["id", "email", "metadata"] });
    const googleEmail = typeof google.user_metadata?.email === "string" ? google.user_metadata.email : undefined;
    const takeEmail = Boolean(googleEmail && (!customer.email || isGuestEmail(customer.email)));
    await customers.updateCustomers(customerId, {
      ...(takeEmail ? { email: googleEmail } : {}),
      metadata: {
        ...(customer.metadata ?? {}),
        siumora_google_identity: authIdentityId,
        ...(takeEmail ? { [VERIFIED_EMAIL_KEY]: googleEmail, [VERIFIED_AT_KEY]: new Date().toISOString() } : {}),
      },
    });
    return true;
  } catch (error) {
    req.scope
      .resolve("logger")
      .warn(`google link failed for ${customerId}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
