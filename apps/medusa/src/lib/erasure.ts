import { randomUUID } from "node:crypto";

import type { MedusaContainer } from "@medusajs/framework/types";
import type {
  IAuthModuleService,
  ICustomerModuleService,
  IOrderModuleService,
} from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { REDACTED, blockedReason, normalisePhone } from "@siumora/core";

import { revokeAllSessions, type SqlClient } from "../modules/customer-session/data";
import { forgetAuthEvents } from "../modules/customer-session/privacy";
import { getStatusRow, type SqlClient as StatusSqlClient } from "../modules/returns-ndr/data";
import { siumoraOrderStatus } from "../modules/siumora-order/identity";
import { identitiesOwnedBy, type SqlClient as OwnershipSqlClient } from "../modules/siumora-order/ownership";
import { fetchOrders } from "./order-card";

/**
 * Erase a customer (auth plan phase 2, account → Privacy; the Medusa twin
 * of the Fastify eraseCustomer). Through Medusa's own module services,
 * never raw writes into Medusa's tables.
 *
 * Refused — left open with the reason — while any of the account's orders
 * is still moving: a parcel in transit needs the address it is going to.
 * Otherwise, in one pass:
 *
 * - the customer record is anonymised (name, phone gone; email replaced by
 *   an `erased-<uuid>` placeholder) and its saved addresses deleted;
 * - its sign-in identities are deleted, so the phone (and a linked Google
 *   account) can no longer sign in to it — signing in again with the same
 *   number makes a new, empty account;
 * - every session is revoked;
 * - its orders are KEPT (CGST Act s.36 — RETENTION_NOTICE) with the
 *   personal fields on their delivery addresses redacted and the derived
 *   phone email replaced;
 * - the phone traces in its auth event log are cleared.
 */

export interface ErasureOutcome {
  readonly erased: boolean;
  readonly reason?: string;
}

const ERASED_EMAIL_DOMAIN = "erased.siumora.in";

export async function eraseCustomer(
  scope: MedusaContainer,
  customerId: string,
  now: Date = new Date(),
): Promise<ErasureOutcome> {
  const pg = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlClient;
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER);

  // ── Can it run? ──
  const owned = await identitiesOwnedBy(pg as unknown as OwnershipSqlClient, customerId, 500);
  const orders = await fetchOrders(scope, owned.map((identity) => identity.order_id));
  const statuses: string[] = [];
  for (const identity of owned) {
    const row = await getStatusRow(pg as unknown as StatusSqlClient, identity.order_id);
    const order = orders.get(identity.order_id);
    statuses.push(row?.status ?? siumoraOrderStatus(order?.status ?? "pending"));
  }
  const reason = blockedReason(statuses) as string | null;
  if (reason) return { erased: false, reason };

  const customers = scope.resolve<ICustomerModuleService>(Modules.CUSTOMER);
  const auth = scope.resolve<IAuthModuleService>(Modules.AUTH);
  const orderModule = scope.resolve<IOrderModuleService>(Modules.ORDER);

  const customer = await customers.retrieveCustomer(customerId, {
    select: ["id", "phone", "metadata"],
    relations: ["addresses"],
  });
  const phone = normalisePhone(customer.phone ?? "") as string | undefined;
  const token = randomUUID();

  // ── Sign-in identities: nothing can sign in to this account again. ──
  const identityIds = new Set<string>();
  if (phone) {
    const providers = await auth.listProviderIdentities({ entity_id: phone, provider: "phone-otp" });
    for (const provider of providers) {
      if (provider.auth_identity_id) identityIds.add(provider.auth_identity_id);
    }
  }
  const linkedGoogle = (customer.metadata as Record<string, unknown> | null)?.siumora_google_identity;
  if (typeof linkedGoogle === "string") identityIds.add(linkedGoogle);
  if (identityIds.size > 0) await auth.deleteAuthIdentities([...identityIds]);

  // ── The customer record and its address book. ──
  const addressIds = (customer.addresses ?? []).map((address) => address.id);
  if (addressIds.length > 0) await customers.deleteCustomerAddresses(addressIds);
  await customers.updateCustomers(customerId, {
    first_name: null,
    last_name: null,
    phone: null,
    company_name: null,
    email: `erased-${token}@${ERASED_EMAIL_DOMAIN}`,
    metadata: { siumora_erased_at: now.toISOString() },
  });

  // ── Sessions and the event log. ──
  await revokeAllSessions(pg, { customerId, reason: "erased", now });
  await forgetAuthEvents(pg, customerId);

  // ── Retained orders: redact the person, keep the tax facts. ──
  for (const identity of owned) {
    const order = orders.get(identity.order_id);
    if (!order) continue;
    try {
      const addressId = (order.shipping_address as { id?: unknown } | null)?.id;
      if (typeof addressId === "string") {
        await orderModule.updateOrderAddresses([
          {
            id: addressId,
            first_name: REDACTED,
            last_name: "",
            phone: REDACTED,
            address_1: REDACTED,
            address_2: null,
            company: null,
          },
        ]);
      }
      await orderModule.updateOrders(order.id, { email: `erased-${token}@${ERASED_EMAIL_DOMAIN}` });
    } catch (error) {
      // The account is already gone; a retained order that kept its address
      // is chased by hand, not a reason to report the erasure failed.
      logger.error(
        `erasure: order ${identity.order_number} not redacted — redact by hand: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return { erased: true };
}
