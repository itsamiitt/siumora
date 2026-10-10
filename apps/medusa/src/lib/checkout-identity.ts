import type { MedusaRequest } from "@medusajs/framework/http";
import type { ICustomerModuleService } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { createCustomerAddressesWorkflow } from "@medusajs/medusa/core-flows";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { normalisePhone } from "@siumora/core";

import { stepUpFresh } from "../modules/customer-session/session";
import { settingsCache } from "../modules/settings/cache";
import { readSettings, type SqlClient as SettingsSqlClient } from "../modules/settings/read";
import { addressKey, decideCodGate, type CodGateDecision } from "../modules/siumora-order/cod-gate";
import { majorToPaise, wireNumber } from "../modules/siumora-order/identity";
import {
  identitiesOwnedBy,
  setOwnerIfUnowned,
  type SqlClient as OwnershipSqlClient,
} from "../modules/siumora-order/ownership";
import { loadCustomer, pgOf } from "./customer-signin";
import { fetchOrders } from "./order-card";
import { currentSession } from "./session-auth";

/**
 * Who is buying, at checkout (auth plan phase 2): the I/O around the pure
 * COD gate, and what happens to a signed-in shopper's order once placed.
 */

export interface CheckoutAddress {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  address_1?: string | null;
  address_2?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
}

async function knownAddressKeys(req: MedusaRequest, customerId: string): Promise<Set<string>> {
  const owned = await identitiesOwnedBy(pgOf(req) as unknown as OwnershipSqlClient, customerId, 200);
  const orders = await fetchOrders(req.scope, owned.map((identity) => identity.order_id));
  const keys = new Set<string>();
  for (const order of orders.values()) {
    const key = addressKey(order.shipping_address as CheckoutAddress | null);
    if (key) keys.add(key);
  }
  return keys;
}

export async function codGate(
  req: MedusaRequest,
  cart: { total?: unknown; shipping_address?: CheckoutAddress | null },
): Promise<CodGateDecision> {
  const settings = await settingsCache(() =>
    readSettings(pgOf(req) as unknown as SettingsSqlClient),
  ).get();
  if (!settings.codRequiresOtp) return { ok: true };

  const session = currentSession(req);
  const customer = session ? await loadCustomer(req, session.customerId) : undefined;
  const signedInPhone = normalisePhone(customer?.phone ?? "") as string | undefined;
  const orderPhone = normalisePhone(cart.shipping_address?.phone ?? "") as string | undefined;
  const totalPaise = cart.total === undefined ? 0 : majorToPaise(wireNumber(cart.total, "total"));

  // Only worth the lookup when the amount could trip the step-up.
  const isNewAddress =
    session && totalPaise > settings.codStepUpAbove
      ? !(await knownAddressKeys(req, session.customerId)).has(
          addressKey(cart.shipping_address) ?? "",
        )
      : false;

  return decideCodGate({
    codRequiresOtp: settings.codRequiresOtp,
    signedInPhone,
    orderPhone,
    totalPaise,
    stepUpAbove: settings.codStepUpAbove,
    isNewAddress,
    stepUpFresh: session ? stepUpFresh(session.stepUpAt, new Date()) : false,
  });
}

/**
 * A signed-in shopper's order is theirs from the start, and its delivery
 * address joins their address book (pre-filled next time) unless it is
 * already there. Best effort: the order is placed whatever happens here.
 */
export async function adoptPlacedOrder(
  req: MedusaRequest,
  orderId: string,
  address: CheckoutAddress | null | undefined,
): Promise<void> {
  const session = currentSession(req);
  if (!session) return;
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

  try {
    await setOwnerIfUnowned(pgOf(req) as unknown as OwnershipSqlClient, orderId, session.customerId);
  } catch (error) {
    logger.error(`order ${orderId} not linked to ${session.customerId}: ${String(error)}`);
  }

  const key = addressKey(address);
  if (!address || !key) return;
  try {
    const customers = req.scope.resolve<ICustomerModuleService>(Modules.CUSTOMER);
    const saved = await customers.listCustomerAddresses({ customer_id: session.customerId });
    if (saved.some((entry) => addressKey(entry) === key)) return;
    await createCustomerAddressesWorkflow(req.scope).run({
      input: {
        addresses: [
          {
            customer_id: session.customerId,
            first_name: address.first_name ?? "",
            last_name: address.last_name ?? "",
            phone: address.phone ?? null,
            address_1: address.address_1 ?? "",
            address_2: address.address_2 ?? null,
            city: address.city ?? "",
            province: address.province ?? null,
            postal_code: address.postal_code ?? "",
            country_code: "in",
            is_default_shipping: saved.length === 0,
          },
        ],
      },
    });
  } catch (error) {
    logger.warn(`address not saved for ${session.customerId}: ${String(error)}`);
  }
}
