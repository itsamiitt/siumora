import assert from "node:assert/strict";
import { test } from "node:test";

import { getAuthContextFromJwtToken } from "@medusajs/framework/http";
import { generateJwtToken } from "@medusajs/framework/utils";

import { hashSessionToken, mintSessionToken } from "../modules/customer-session/session.ts";
import { refuseCustomerTokenMinting, sessionAuth } from "./session-auth.ts";

/**
 * The session door, against a fake request: what a live, dead or blocked
 * session does to the request, and what happens to customer JWTs that did
 * not come from a session.
 */

const SECRET = "test-jwt-secret";

const sign = (payload: Record<string, unknown>) =>
  generateJwtToken(payload, { secret: SECRET, expiresIn: "1h" });

interface FakeRow {
  token: string;
  blocked?: boolean;
  lastSeenAt?: Date;
}

function fakeRequest(input: { authorization?: string; url?: string; row?: FakeRow }) {
  const sql: string[] = [];
  const pg = {
    async raw(query: string, bindings: unknown[] = []) {
      sql.push(query);
      if (query.includes("FROM siumora_customer_session s") && input.row && bindings[0] === hashSessionToken(input.row.token)) {
        return {
          rows: [
            {
              id: "sises_1",
              customer_id: "cus_1",
              auth_identity_id: "authid_1",
              kind: "customer",
              last_seen_at: (input.row.lastSeenAt ?? new Date()).toISOString(),
              expires_at: new Date(Date.now() + 86_400_000).toISOString(),
              step_up_at: null,
              blocked_at: input.row.blocked ? new Date().toISOString() : null,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const services: Record<string, unknown> = {
    __pg_connection__: pg,
    logger: { error() {}, warn() {} },
    configModule: { projectConfig: { http: { jwtSecret: SECRET } } },
  };
  const req = {
    headers: { ...(input.authorization ? { authorization: input.authorization } : {}) } as Record<string, string | undefined>,
    originalUrl: input.url ?? "/store/customers/me",
    url: input.url ?? "/store/customers/me",
    scope: { resolve: (key: string) => services[key] },
  } as unknown as Parameters<typeof sessionAuth>[0] & {
    auth_context?: Record<string, unknown>;
    siumora_session?: { id: string };
  };
  return { req, sql };
}

async function run(req: Parameters<typeof sessionAuth>[0]) {
  let called = false;
  await sessionAuth(req, {} as never, () => {
    called = true;
  });
  return called;
}

test("a live session becomes the customer, with a short Medusa JWT in its place", async () => {
  const token = mintSessionToken();
  const { req } = fakeRequest({ authorization: `Bearer ${token}`, row: { token } });
  assert.equal(await run(req), true);

  const header = String(req.headers.authorization);
  assert.ok(!header.includes(token), "the session token never reaches the route");
  const decoded = getAuthContextFromJwtToken(header, SECRET, ["bearer"], ["customer"]) as unknown as Record<string, unknown>;
  assert.equal(decoded.actor_id, "cus_1");
  assert.equal(decoded.actor_type, "customer");
  assert.ok(Number(decoded.exp) - Number(decoded.iat) <= 300, "five minutes at most");
  assert.equal((req as { auth_context?: { actor_id?: string } }).auth_context?.actor_id, "cus_1");
  assert.equal((req as { siumora_session?: { id: string } }).siumora_session?.id, "sises_1");
});

test("an unknown or revoked session continues anonymous", async () => {
  const { req } = fakeRequest({ authorization: `Bearer ${mintSessionToken()}` });
  assert.equal(await run(req), true);
  assert.equal(req.headers.authorization, undefined);
  assert.equal((req as { auth_context?: unknown }).auth_context, undefined);
});

test("a blocked customer's session is treated as no session", async () => {
  const token = mintSessionToken();
  const { req } = fakeRequest({ authorization: `Bearer ${token}`, row: { token, blocked: true } });
  assert.equal(await run(req), true);
  assert.equal(req.headers.authorization, undefined);
  assert.equal((req as { siumora_session?: unknown }).siumora_session, undefined);
});

test("activity rolls the session, but not on every request", async () => {
  const token = mintSessionToken();
  const fresh = fakeRequest({ authorization: `Bearer ${token}`, row: { token } });
  await run(fresh.req);
  assert.ok(!fresh.sql.some((query) => query.startsWith("UPDATE")), "seen a moment ago: no write");

  const stale = fakeRequest({
    authorization: `Bearer ${token}`,
    row: { token, lastSeenAt: new Date(Date.now() - 3_600_000) },
  });
  await run(stale.req);
  assert.ok(stale.sql.some((query) => query.startsWith("UPDATE siumora_customer_session")));
});

test("a raw customer JWT on /store is dropped — sessions only", async () => {
  const customerJwt = sign({ actor_id: "cus_9", actor_type: "customer" });
  const { req } = fakeRequest({ authorization: `Bearer ${customerJwt}` });
  (req as { auth_context?: unknown }).auth_context = { actor_id: "cus_9" };
  assert.equal(await run(req), true);
  assert.equal(req.headers.authorization, undefined);
  assert.equal((req as { auth_context?: unknown }).auth_context, undefined);
});

test("...except on the Google hand-off, which exists to exchange it", async () => {
  const customerJwt = sign({ actor_id: "", actor_type: "customer" });
  const { req } = fakeRequest({ authorization: `Bearer ${customerJwt}`, url: "/store/siumora-auth/google" });
  await run(req);
  assert.equal(req.headers.authorization, `Bearer ${customerJwt}`);
});

test("dashboard users' tokens are not the door's business", async () => {
  const userJwt = sign({ actor_id: "user_1", actor_type: "user" });
  const { req } = fakeRequest({ authorization: `Bearer ${userJwt}`, url: "/admin/siumora/metrics" });
  await run(req);
  assert.equal(req.headers.authorization, `Bearer ${userJwt}`);
});

test("refresh and session exchange refuse a customer bearer, not a user's", () => {
  const customerJwt = sign({ actor_type: "customer" });
  const userJwt = sign({ actor_type: "user" });
  let status = 0;
  let passed = false;
  const res = { status: (code: number) => ((status = code), { json: () => undefined }) } as never;

  refuseCustomerTokenMinting({ headers: { authorization: `Bearer ${customerJwt}` } } as never, res, () => {
    passed = true;
  });
  assert.equal(status, 403);
  assert.equal(passed, false);

  refuseCustomerTokenMinting({ headers: { authorization: `Bearer ${userJwt}` } } as never, res, () => {
    passed = true;
  });
  assert.equal(passed, true);
});
