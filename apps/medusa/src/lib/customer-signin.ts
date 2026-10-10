import type { MedusaRequest } from "@medusajs/framework/http";
import type { AuthIdentityDTO, IAuthModuleService } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  createCustomerAccountWorkflow,
  setAuthAppMetadataWorkflow,
} from "@medusajs/medusa/core-flows";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { maskPhone, normalisePhone, parseAdminRoles } from "@siumora/core";

import {
  createSession,
  knownDevices,
  readSecurity,
  recordAuthEvent,
  type AuthEventWrite,
  type CreatedSession,
  type SqlClient,
} from "../modules/customer-session/data";
import {
  coarseIp,
  deviceLabel,
  isNewDevice,
  phoneKey,
  type SessionKind,
} from "../modules/customer-session/session";
import { emailVerified } from "./email-verification";
import { guestEmail, realEmail } from "./guest-email";

/**
 * The I/O half of signing a customer in, shared by the phone verify route
 * and (phase 4) the Google link route: find or create the Medusa customer
 * for a verified auth identity, open a revocable session, and record it.
 */

export function pgOf(req: MedusaRequest): SqlClient {
  return req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlClient;
}

/** The secret phone numbers are keyed with in the event log. */
export function eventSecret(env: Record<string, string | undefined> = process.env): string {
  return env.AUTH_EVENT_SECRET ?? env.JWT_SECRET ?? "siumora-dev-event-secret";
}

/** Common fields every auth event from this request carries. */
export function eventContext(req: MedusaRequest, phone?: string): Partial<AuthEventWrite> {
  return {
    ip: coarseIp(req.ip),
    device: deviceLabel(String(req.headers["user-agent"] ?? "")),
    ...(phone ? { maskedPhone: maskPhone(phone), phoneKey: phoneKey(phone, eventSecret()) } : {}),
  };
}

export async function logAuthEvent(
  req: MedusaRequest,
  event: AuthEventWrite,
  phone?: string,
): Promise<void> {
  await recordAuthEvent(pgOf(req), { ...eventContext(req, phone), ...event });
}

/** ADMIN_PHONES decides operator sessions, read on every sign-in. */
export function sessionKindFor(
  phone: string,
  env: Record<string, string | undefined> = process.env,
): SessionKind {
  return parseAdminRoles(env.ADMIN_PHONES).has(phone) ? "operator" : "customer";
}

export interface CustomerRow {
  id: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  has_account?: boolean;
  metadata?: Record<string, unknown> | null;
}

const CUSTOMER_FIELDS = ["id", "email", "phone", "first_name", "last_name", "has_account", "metadata"];

export async function loadCustomer(
  req: MedusaRequest,
  customerId: string,
): Promise<CustomerRow | undefined> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "customer",
    fields: CUSTOMER_FIELDS,
    filters: { id: customerId },
  });
  return data[0] as CustomerRow | undefined;
}

/**
 * The customer a verified phone identity signs in as.
 *
 * - The identity already carries a customer id → that customer.
 * - Else a registered customer already holds this phone's derived email
 *   (an earlier half-finished sign-in, or a re-created identity) → link it.
 * - Else create one. Medusa needs an email to create a customer; phone
 *   sign-in has none, so the derived placeholder goes in and every read maps
 *   it back to null (guest-email.ts).
 */
export async function ensureCustomer(
  req: MedusaRequest,
  identity: AuthIdentityDTO,
  phone: string,
): Promise<string> {
  const linked = identity.app_metadata?.customer_id;
  if (typeof linked === "string" && linked) return linked;

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: existing } = await query.graph({
    entity: "customer",
    fields: ["id"],
    filters: { email: guestEmail(phone), has_account: true },
  });
  const found = existing[0] as { id: string } | undefined;
  if (found) {
    await setAuthAppMetadataWorkflow(req.scope).run({
      input: { authIdentityId: identity.id, actorType: "customer", value: found.id },
    });
    return found.id;
  }

  const { result } = await createCustomerAccountWorkflow(req.scope).run({
    input: {
      authIdentityId: identity.id,
      customerData: { email: guestEmail(phone), phone },
    },
  });
  return result.id;
}

/**
 * The customer's phone, but only if it is VERIFIED: the number's own
 * phone-otp sign-in identity is linked to this customer. `customer.phone`
 * alone is a column — an admin can edit it, and before the security review
 * a customer could too — so nothing that grants power (operator role,
 * step-up target, guest-order claims, the COD gate, erasure) reads it bare.
 */
export async function verifiedPhone(
  req: MedusaRequest,
  customerId: string,
  customer?: CustomerRow,
): Promise<string | undefined> {
  const row = customer ?? (await loadCustomer(req, customerId));
  const phone = normalisePhone(row?.phone ?? "") as string | undefined;
  if (!phone) return undefined;
  const auth = req.scope.resolve<IAuthModuleService>(Modules.AUTH);
  const providers = await auth.listProviderIdentities({ entity_id: phone, provider: "phone-otp" });
  for (const provider of providers) {
    if (!provider.auth_identity_id) continue;
    const identity = await auth.retrieveAuthIdentity(provider.auth_identity_id);
    if (identity.app_metadata?.customer_id === customerId) return phone;
  }
  return undefined;
}

export async function isBlocked(req: MedusaRequest, customerId: string): Promise<boolean> {
  return (await readSecurity(pgOf(req), customerId)).blockedAt !== null;
}

export interface OpenedSession extends CreatedSession {
  readonly kind: SessionKind;
  readonly device: string;
  /** True when this device label is new for an account that has others. */
  readonly newDevice: boolean;
}

export async function openSession(
  req: MedusaRequest,
  input: { customerId: string; authIdentityId: string; phone: string; stepUp?: boolean },
): Promise<OpenedSession> {
  const pg = pgOf(req);
  const now = new Date();
  const userAgent = String(req.headers["user-agent"] ?? "");
  const device = deviceLabel(userAgent);
  const known = await knownDevices(pg, input.customerId, now).catch(() => [] as string[]);
  const kind = sessionKindFor(input.phone);
  const created = await createSession(pg, {
    customerId: input.customerId,
    authIdentityId: input.authIdentityId,
    kind,
    device,
    userAgent,
    ip: coarseIp(req.ip),
    now,
    ...(input.stepUp === false ? { stepUp: false } : {}),
  });
  return { ...created, kind, device, newDevice: isNewDevice(device, known) };
}

/** The Fastify session envelope's customer card. */
export function customerCard(customer: CustomerRow, phone: string) {
  return {
    id: customer.id,
    phone,
    maskedPhone: maskPhone(phone),
    name: [customer.first_name ?? "", customer.last_name ?? ""].join(" ").trim(),
    email: realEmail(customer.email),
    emailVerified: emailVerified(realEmail(customer.email), customer.metadata),
  };
}
