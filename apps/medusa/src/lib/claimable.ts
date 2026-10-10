import type { MedusaRequest } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import {
  unownedIdentities,
  type OwnedIdentityRow,
  type SqlClient,
} from "../modules/siumora-order/ownership";
import { pgOf, verifiedPhone } from "./customer-signin";
import { guestEmail } from "./guest-email";

/**
 * The guest orders an account may claim: placed without signing in, on the
 * account's own (verified) phone — found by the derived guest email that
 * guest checkout stamps on the cart — and not yet owned by anyone.
 */
export async function claimableIdentities(
  req: MedusaRequest,
  customerId: string,
): Promise<OwnedIdentityRow[]> {
  const phone = await verifiedPhone(req, customerId);
  if (!phone) return [];

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "order",
    fields: ["id"],
    filters: { email: guestEmail(phone) },
  });
  const orderIds = (data as Array<{ id: string }>).map((order) => order.id);
  return unownedIdentities(pgOf(req) as unknown as SqlClient, orderIds);
}
