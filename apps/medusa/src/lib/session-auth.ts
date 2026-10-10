import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import {
  ContainerRegistrationKeys,
  generateJwtToken,
} from "@medusajs/framework/utils";

import {
  resolveSession,
  touchSession,
  type ResolvedSession,
  type SqlClient,
} from "../modules/customer-session/data";
import {
  REQUEST_JWT_TTL,
  sessionTokenFromHeader,
  touchDecision,
} from "../modules/customer-session/session";

/**
 * The session door (auth plan phase 1) — mounted on /store and
 * /admin/siumora ahead of every route (src/api/middlewares.ts).
 *
 * A request carrying `Authorization: Bearer sst_…` is resolved against the
 * session table:
 *
 * - live → the request continues as that customer: `req.auth_context` is
 *   set for routes that already ran past Medusa's global /store auth, and
 *   the header is swapped for a 5-minute Medusa JWT so every route-level
 *   authenticate() downstream (e.g. /store/customers/me) verifies it as
 *   usual. The minted JWT never leaves the process.
 * - revoked, expired, unknown, or its owner blocked → the header is
 *   dropped and the request continues ANONYMOUS. That is the Fastify
 *   resolveViewer posture: browsing keeps working, and signed-in-only
 *   routes answer their own 401.
 *
 * Anything that is not an `sst_` token (a Medusa JWT, a secret API key) is
 * left alone for Medusa to judge.
 */

export interface SiumoraSessionContext {
  readonly id: string;
  readonly customerId: string;
  readonly kind: "customer" | "operator";
  readonly stepUpAt: Date | null;
  /** The raw token, so sign-out can revoke exactly this session. */
  readonly token: string;
}

type SessionRequest = MedusaRequest & {
  auth_context?: Record<string, unknown>;
  siumora_session?: SiumoraSessionContext;
};

export function currentSession(req: MedusaRequest): SiumoraSessionContext | undefined {
  return (req as SessionRequest).siumora_session;
}

function pgOf(req: MedusaRequest): SqlClient {
  return req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlClient;
}

/** Medusa's own JWT shape (generateJwtTokenForAuthIdentity), so a route
 *  cannot tell a session-derived request from a directly signed-in one. */
function authContextFor(session: ResolvedSession): Record<string, unknown> {
  return {
    actor_id: session.customerId,
    actor_type: "customer",
    auth_identity_id: session.authIdentityId,
    auth_provider: "phone-otp",
    mfa_enabled: false,
    mfa_challenge_completed_at: null,
    app_metadata: { customer_id: session.customerId },
    user_metadata: {},
  };
}

/** The one store route that takes a raw customer JWT: Google's hand-off. */
const GOOGLE_HANDOFF_PATH = "/store/siumora-auth/google";

export async function sessionAuth(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction,
): Promise<void> {
  const token = sessionTokenFromHeader(req.headers.authorization);
  if (!token) {
    // A customer JWT straight from a client — a Google callback token, an
    // old token from before sessions — is not a session: it cannot be
    // revoked or blocked. On /store a customer is signed in by session
    // only, so it is dropped (Medusa's global /store auth may already have
    // read it, hence the auth_context too). Google's hand-off route is the
    // one exception: that token is exactly what it exchanges.
    const path = (req.originalUrl ?? req.url).split("?")[0] ?? "";
    if (
      unverifiedActorType(req.headers.authorization) === "customer" &&
      path.startsWith("/store") &&
      path !== GOOGLE_HANDOFF_PATH
    ) {
      delete req.headers.authorization;
      delete (req as SessionRequest).auth_context;
    }
    return next();
  }

  const request = req as SessionRequest;
  const pg = pgOf(req);
  const now = new Date();

  let session: ResolvedSession | undefined;
  try {
    session = await resolveSession(pg, token, now);
  } catch (error) {
    // The session table is unreachable. Anonymous, loudly: refusing every
    // request would take browsing down with a sign-in fault.
    req.scope
      .resolve(ContainerRegistrationKeys.LOGGER)
      .error(`session lookup failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!session || session.blocked) {
    delete req.headers.authorization;
    return next();
  }

  const authContext = authContextFor(session);
  const { http } = req.scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE).projectConfig;
  const jwt = generateJwtToken(authContext, {
    secret: http.jwtSecret as string,
    expiresIn: REQUEST_JWT_TTL,
    jwtOptions: http.jwtOptions,
  });
  req.headers.authorization = `Bearer ${jwt}`;
  request.auth_context = authContext;
  request.siumora_session = {
    id: session.id,
    customerId: session.customerId,
    kind: session.kind,
    stepUpAt: session.stepUpAt,
    token,
  };

  const touch = touchDecision(session, now);
  if (touch.touch) {
    // Rolling expiry. A failed touch costs one sliding window, not the
    // request.
    await touchSession(pg, session.id, now, touch.expiresAt).catch(() => undefined);
  }
  next();
}

/** The payload of a JWT, unverified — only used to route, never to trust. */
function unverifiedActorType(header: unknown): string | undefined {
  if (typeof header !== "string") return undefined;
  const token = /^Bearer\s+(\S+)$/i.exec(header.trim())?.[1];
  const payload = token?.split(".")[1];
  if (!payload) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      actor_type?: unknown;
    };
    return typeof decoded.actor_type === "string" ? decoded.actor_type : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Close the doors that would mint a customer credential outside the session
 * table. Without this, a customer JWT from the built-in routes would outlive
 * sign-out-everywhere and a block:
 *
 * - /auth/customer/phone-otp[/register|/callback] — the built-in auth route
 *   for our provider. Sign-in goes through /store/siumora-auth/verify, which
 *   creates a revocable session and applies the abuse caps.
 * - /auth/token/refresh and /auth/session with a customer bearer — a
 *   refreshed JWT, or a cookie session, would never be revoked. Dashboard
 *   users (actor_type "user") pass untouched.
 */
export function closedCustomerAuthRoute(
  _req: MedusaRequest,
  res: MedusaResponse,
): void {
  res.status(404).json({
    error: "not_found",
    message: "Sign in through /store/siumora-auth.",
  });
}

export function refuseCustomerTokenMinting(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
): void {
  if (unverifiedActorType(req.headers.authorization) === "customer") {
    res.status(403).json({
      error: "use_session",
      message: "Customer sessions are issued by /store/siumora-auth.",
    });
    return;
  }
  next();
}
