import type { FastifyReply, FastifyRequest } from "fastify";

import {
  can,
  roleFor,
  stepUpValid,
  type AuditAction,
  type Permission,
  type Role,
} from "@siumora/core";
import { findSession, recordAudit, totpState, type CustomerRow } from "@siumora/db";

/**
 * Who is making this request?
 *
 * The token may arrive as a bearer header (the storefront's server calls) or as
 * a cookie (a browser calling the API directly). Both are read, so the same API
 * serves both without a second auth scheme.
 */

export interface Viewer {
  readonly customer: CustomerRow;
  readonly sessionId: string;
  /**
   * Derived from the ADMIN_PHONES allow-list on every request, never stored on
   * the session. Removing a number from the environment therefore takes effect
   * immediately rather than whenever a 30-day session happens to lapse.
   */
  readonly isAdmin: boolean;
  /** Undefined for a shopper. Demoting somebody takes effect on the next call. */
  readonly role?: Role;
  /** When this session last passed the second factor, if ever. */
  readonly twoFactorAt?: Date | null;
}

const SESSION_COOKIE = "siumora_session";

export function tokenFrom(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    if (token) return token;
  }

  const cookie = request.headers.cookie;
  if (typeof cookie === "string") {
    for (const part of cookie.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === SESSION_COOKIE && rest.length > 0) {
        return decodeURIComponent(rest.join("="));
      }
    }
  }

  return undefined;
}

/** Resolve the caller, or `undefined` for an anonymous request. */
export async function resolveViewer(
  request: FastifyRequest,
): Promise<Viewer | undefined> {
  const token = tokenFrom(request);
  if (!token) return undefined;

  const session = await findSession(request.server.db, token);
  if (!session) return undefined;

  const role = roleFor(session.customer.phone, request.server.adminRoles);

  return {
    customer: session.customer,
    sessionId: session.sessionId,
    isAdmin: role !== undefined,
    ...(role ? { role } : {}),
    twoFactorAt: session.twoFactorAt ?? null,
  };
}

/**
 * Require a signed-in customer, replying 401 if there is none.
 *
 * Returns `undefined` after replying, so a route reads as
 * `const viewer = await requireCustomer(...); if (!viewer) return;`
 */
export async function requireCustomer(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Viewer | undefined> {
  const viewer = await resolveViewer(request);
  if (!viewer) {
    await reply.code(401).send({
      error: "not_signed_in",
      message: "Sign in to continue.",
    });
    return undefined;
  }
  return viewer;
}

/**
 * Require an operator.
 *
 * A signed-in customer who is not on the allow-list gets 403, not 404: they are
 * a known person being refused, and pretending the route does not exist would
 * only make the refusal harder to debug. An anonymous caller gets 401.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Viewer | undefined> {
  const viewer = await resolveViewer(request);
  if (!viewer) {
    await reply.code(401).send({
      error: "not_signed_in",
      message: "Sign in to continue.",
    });
    return undefined;
  }
  if (!viewer.isAdmin) {
    await reply.code(403).send({
      error: "not_an_operator",
      message: "This account cannot open the ops dashboard.",
    });
    return undefined;
  }
  return viewer;
}

/**
 * Require an operator who has passed their second factor.
 *
 * Only for accounts that enrolled one. Making it unconditional would lock out
 * every operator the moment this shipped, and a security control that has to be
 * turned off to get work done is not one.
 *
 * The 2FA routes themselves use `requireAdmin`, not this — otherwise the only
 * way to step up would be to already be stepped up.
 */
export async function requireSteppedUpAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Viewer | undefined> {
  const viewer = await requireAdmin(request, reply);
  if (!viewer) return undefined;

  const state = await totpState(request.server.db, viewer.customer.id);
  if (!state.enrolled) return viewer;

  if (!stepUpValid(viewer.twoFactorAt)) {
    await reply.code(403).send({
      error: "two_factor_required",
      message: "Enter the code from your authenticator app to continue.",
    });
    return undefined;
  }

  return viewer;
}

/**
 * Require a specific permission.
 *
 * The refusal names the permission rather than saying "no". An operator told
 * only that they cannot do something goes and asks an owner to try it too,
 * which is two people's time to learn one fact.
 *
 * Checked against the environment on every call, like the allow-list it
 * replaces: demoting somebody takes effect on their next request, not when
 * their session lapses.
 */
export async function requirePermission(
  request: FastifyRequest,
  reply: FastifyReply,
  permission: Permission,
): Promise<Viewer | undefined> {
  // Every permission-gated route is behind the second factor, for operators who
  // have one. These are the routes that move money and erase people.
  const viewer = await requireSteppedUpAdmin(request, reply);
  if (!viewer) return undefined;

  if (!can(viewer.role, permission)) {
    await reply.code(403).send({
      error: "insufficient_role",
      message: `${article(viewer.role)} ${viewer.role} cannot do this. Needs: ${permission}.`,
      needs: permission,
      role: viewer.role,
    });
    return undefined;
  }

  return viewer;
}

/** "an operator", "an owner", "a viewer". Two of the three roles need "an". */
function article(role: Role | undefined): string {
  return role && /^[aeiou]/i.test(role) ? "An" : "A";
}

/**
 * Write an audit entry for the action just taken.
 *
 * Takes the viewer rather than a phone so the actor cannot be mistyped, and
 * never throws: the write it describes has already happened, and failing after
 * the fact would leave the log and the world disagreeing in the worse
 * direction. A failure is logged loudly instead.
 */
export async function audit(
  request: FastifyRequest,
  viewer: Viewer,
  action: AuditAction,
  options: { subject?: string; detail?: unknown } = {},
): Promise<void> {
  const result = await recordAudit(request.server.db, {
    actorId: viewer.customer.id,
    actorPhone: viewer.customer.phone,
    actorRole: viewer.role ?? "viewer",
    action,
    ...(options.subject ? { subject: options.subject } : {}),
    ...(options.detail !== undefined ? { detail: options.detail } : {}),
    ip: request.ip,
  });

  if (!result.recorded) {
    request.log?.error?.(
      { err: result.error, action, subject: options.subject },
      "audit entry not recorded",
    );
  }
}
