import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { recordAudit, type SqlClient } from "../modules/audit/data";
import {
  NOT_SIGNED_IN,
  decidePermission,
  decideRole,
  operatorContact,
  type Permission,
  type Role,
} from "./operator";

/**
 * The operator gate's I/O half — the Medusa twin of the Fastify
 * requirePermission ladder (apps/api/src/lib/auth.ts). Decisions are pure
 * and live in operator.ts; this file reads auth_context (populated by the
 * authenticate middleware registered for /admin/siumora in
 * src/api/middlewares.ts), loads the actor's stored contact, and writes the
 * refusal envelopes.
 *
 * Two actor types pass: an emailpass dashboard user (owner until the RBAC
 * port narrows it) and a phone-OTP customer on ADMIN_PHONES — the latter is
 * how the SDK's admin reads authenticate (the recorded contract signs in the
 * operator by phone; see sdk-contract.test.ts "admin reads").
 */

export interface Operator {
  readonly actorId: string;
  readonly actorType: "user" | "customer";
  /** Email (user) or phone (customer), as stored. Never serve unmasked. */
  readonly contact: string;
  readonly role: Role;
  readonly permissions: readonly Permission[];
}

interface AuthContext {
  actor_id?: string;
  actor_type?: string;
}

async function loadContact(
  req: MedusaRequest,
  actorType: "user" | "customer",
  actorId: string,
): Promise<string | null> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: actorType,
    fields: [actorType === "user" ? "email" : "phone"],
    filters: { id: actorId },
  });
  const row = data[0] as { email?: string | null; phone?: string | null } | undefined;
  return (actorType === "user" ? row?.email : row?.phone) ?? null;
}

export async function requireOperator(
  req: MedusaRequest,
  res: MedusaResponse,
  permission: Permission,
): Promise<Operator | undefined> {
  const auth = (req as { auth_context?: AuthContext }).auth_context;
  const actorId = auth?.actor_id;
  const actorType = auth?.actor_type;

  if (!actorId || (actorType !== "user" && actorType !== "customer")) {
    res.status(NOT_SIGNED_IN.code).json(NOT_SIGNED_IN.body);
    return undefined;
  }

  const contact = await loadContact(req, actorType, actorId);
  const decision = decideRole({ actorType, contact }, process.env);
  if (!decision.ok) {
    res.status(decision.refusal.code).json(decision.refusal.body);
    return undefined;
  }

  const allowed = decidePermission(decision.role, permission);
  if (!allowed.ok) {
    res.status(allowed.refusal.code).json(allowed.refusal.body);
    return undefined;
  }

  return {
    actorId,
    actorType,
    contact: operatorContact(actorType, contact),
    role: decision.role,
    permissions: decision.permissions,
  };
}

/**
 * Write an audit entry for the action just taken. Takes the operator rather
 * than a contact so the actor cannot be mistyped, and never throws: the
 * action it describes has already happened. A failure is logged loudly
 * instead (Fastify audit() posture).
 */
export async function auditAction(
  req: MedusaRequest,
  operator: Operator,
  action: string,
  options: { subject?: string; detail?: unknown } = {},
): Promise<void> {
  const pg = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as SqlClient;
  const result = await recordAudit(pg, {
    actorId: operator.actorId,
    actorContact: operator.contact,
    actorRole: operator.role,
    action,
    ...(options.subject ? { subject: options.subject } : {}),
    ...(options.detail !== undefined ? { detail: options.detail } : {}),
    ip: req.ip,
  });
  if (!result.recorded) {
    // eslint-disable-next-line no-console
    console.error("audit entry not recorded", {
      action,
      subject: options.subject,
      error: result.error,
    });
  }
}
