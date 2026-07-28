import type { FastifyReply, FastifyRequest } from "fastify";

import { isAdminPhone } from "@siumora/core";
import { findSession, type CustomerRow } from "@siumora/db";

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

  return {
    customer: session.customer,
    sessionId: session.sessionId,
    isAdmin: isAdminPhone(session.customer.phone, request.server.adminPhones),
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
