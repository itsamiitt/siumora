import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createSession,
  recordAuthEvent,
  resolveSession,
  revokeAllSessions,
  revokeSessionById,
  type SqlClient,
} from "./data.ts";
import { healthWindow, summariseHealth } from "./health.ts";
import { openPrivacyRequest } from "./privacy.ts";
import {
  STEP_UP_WINDOW_SECONDS,
  TOUCH_INTERVAL_MS,
  coarseIp,
  deviceLabel,
  hashSessionToken,
  initialExpiry,
  isNewDevice,
  isSessionToken,
  mintSessionToken,
  phoneKey,
  sessionTokenFromHeader,
  sessionView,
  stepUpFresh,
  touchDecision,
} from "./session.ts";

const DAY = 86_400_000;

// ── Tokens ──────────────────────────────────────────────────────────────

test("a minted token is 256 random bits behind the sst_ prefix, never repeated", () => {
  const a = mintSessionToken();
  const b = mintSessionToken();
  assert.ok(isSessionToken(a), a);
  assert.notEqual(a, b);
  assert.equal(a.length, 4 + 43);
});

test("only the hash is stored, and it is stable", () => {
  const token = mintSessionToken();
  assert.equal(hashSessionToken(token), hashSessionToken(token));
  assert.notEqual(hashSessionToken(token), token);
  assert.match(hashSessionToken(token), /^[0-9a-f]{64}$/);
});

test("the header parser takes our bearer and leaves everything else to Medusa", () => {
  const token = mintSessionToken();
  assert.equal(sessionTokenFromHeader(`Bearer ${token}`), token);
  assert.equal(sessionTokenFromHeader(`bearer ${token}`), token);
  assert.equal(sessionTokenFromHeader("Bearer eyJhbGciOi.eyJ.sig"), undefined);
  assert.equal(sessionTokenFromHeader("Basic sk_123"), undefined);
  assert.equal(sessionTokenFromHeader(`Bearer ${token}x`), undefined);
  assert.equal(sessionTokenFromHeader(undefined), undefined);
});

// ── Lifetimes ───────────────────────────────────────────────────────────

test("customer sessions last 30 days, operator sessions 12 hours", () => {
  const now = new Date("2026-10-10T00:00:00Z");
  assert.equal(initialExpiry("customer", now).getTime() - now.getTime(), 30 * DAY);
  assert.equal(initialExpiry("operator", now).getTime() - now.getTime(), 12 * 3_600_000);
});

test("customer sessions roll on activity, but not on every page view", () => {
  const created = new Date("2026-10-01T00:00:00Z");
  const session = {
    kind: "customer" as const,
    lastSeenAt: created,
    expiresAt: initialExpiry("customer", created),
  };

  const soon = new Date(created.getTime() + TOUCH_INTERVAL_MS - 1);
  assert.deepEqual(touchDecision(session, soon), { touch: false, expiresAt: session.expiresAt });

  const later = new Date(created.getTime() + 5 * DAY);
  const decision = touchDecision(session, later);
  assert.equal(decision.touch, true);
  assert.equal(decision.expiresAt.getTime(), later.getTime() + 30 * DAY);
});

test("operator sessions never extend — 12 hours from sign-in, however busy", () => {
  const created = new Date("2026-10-01T00:00:00Z");
  const session = { kind: "operator" as const, lastSeenAt: created, expiresAt: initialExpiry("operator", created) };
  const decision = touchDecision(session, new Date(created.getTime() + 6 * 3_600_000));
  assert.equal(decision.touch, true);
  assert.equal(decision.expiresAt, session.expiresAt);
});

test("step-up is fresh for ten minutes after an OTP, then not", () => {
  const at = new Date("2026-10-10T10:00:00Z");
  assert.equal(stepUpFresh(at, new Date(at.getTime() + STEP_UP_WINDOW_SECONDS * 1000)), true);
  assert.equal(stepUpFresh(at, new Date(at.getTime() + STEP_UP_WINDOW_SECONDS * 1000 + 1)), false);
  assert.equal(stepUpFresh(null, at), false);
  // A clock that went backwards is not a licence.
  assert.equal(stepUpFresh(at, new Date(at.getTime() - 1000)), false);
});

// ── Devices, alerts, privacy of the log ─────────────────────────────────

test("device labels are coarse and recognisable", () => {
  const android =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
  const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  assert.equal(deviceLabel(android), "Chrome on Android");
  assert.equal(deviceLabel(iphone), "Safari on iPhone");
  assert.equal(deviceLabel(""), "Unknown device");
  assert.equal(deviceLabel("node"), "App");
});

test("a new-device alert needs a history to be new against", () => {
  assert.equal(isNewDevice("Chrome on Android", []), false, "first ever sign-in is not news");
  assert.equal(isNewDevice("Chrome on Android", ["Chrome on Android"]), false);
  assert.equal(isNewDevice("Safari on iPhone", ["Chrome on Android"]), true);
});

test("the event log keys phones and coarsens addresses", () => {
  assert.equal(phoneKey("9812345678", "s1"), phoneKey("9812345678", "s1"));
  assert.notEqual(phoneKey("9812345678", "s1"), phoneKey("9812345678", "s2"));
  assert.ok(!phoneKey("9812345678", "s1").includes("9812345678"));
  assert.equal(coarseIp("203.0.113.77"), "203.0.113.0/24");
  assert.equal(coarseIp("::ffff:203.0.113.77"), "203.0.113.0/24");
  assert.equal(coarseIp("2001:db8:abcd:12::1"), "2001:db8:abcd::/48");
  assert.equal(coarseIp(undefined), null);
});

test("the customer's device list carries no IP and marks the current one", () => {
  const row = {
    id: "sises_1",
    device: "Chrome on Android",
    ip: "203.0.113.0/24",
    created_at: "2026-10-01T00:00:00.000Z",
    last_seen_at: "2026-10-09T00:00:00.000Z",
    expires_at: "2026-11-08T00:00:00.000Z",
  };
  const view = sessionView(row, "sises_1");
  assert.equal(view.current, true);
  assert.ok(!("ip" in view));
  assert.equal(sessionView(row, "sises_2").current, false);
});

// ── SQL paths (fake pg) ─────────────────────────────────────────────────

function fakePg(answer: (sql: string, bindings: readonly unknown[]) => unknown[] = () => []) {
  const calls: Array<{ sql: string; bindings: readonly unknown[] }> = [];
  const pg: SqlClient = {
    async raw(sql, bindings = []) {
      calls.push({ sql, bindings });
      return { rows: answer(sql, bindings) };
    },
  };
  return { pg, calls };
}

test("creating a session stores the hash, not the token, and starts stepped up", async () => {
  const { pg, calls } = fakePg();
  const now = new Date("2026-10-10T00:00:00Z");
  const created = await createSession(pg, {
    customerId: "cus_1",
    authIdentityId: "authid_1",
    kind: "customer",
    device: "Chrome on Android",
    userAgent: "ua",
    ip: "203.0.113.0/24",
    now,
  });
  const bindings = calls[0]!.bindings;
  assert.ok(!bindings.includes(created.token), "raw token never reaches the database");
  assert.ok(bindings.includes(hashSessionToken(created.token)));
  assert.equal(bindings[10], now.toISOString(), "step_up_at = sign-in time");
  assert.equal(created.expiresAt.getTime(), now.getTime() + 30 * DAY);
});

test("resolving looks up by hash, only live rows, and reports a block", async () => {
  const token = mintSessionToken();
  const { pg, calls } = fakePg(() => [
    {
      id: "sises_1",
      customer_id: "cus_1",
      auth_identity_id: "authid_1",
      kind: "customer",
      last_seen_at: "2026-10-09T00:00:00Z",
      expires_at: "2026-11-08T00:00:00Z",
      step_up_at: null,
      blocked_at: "2026-10-09T12:00:00Z",
    },
  ]);
  const resolved = await resolveSession(pg, token, new Date("2026-10-10T00:00:00Z"));
  assert.equal(calls[0]!.bindings[0], hashSessionToken(token));
  assert.match(calls[0]!.sql, /revoked_at IS NULL/);
  assert.match(calls[0]!.sql, /expires_at > \?/);
  assert.equal(resolved?.blocked, true);
  assert.equal(resolved?.stepUpAt, null);
});

test("an unknown token resolves to nothing", async () => {
  const { pg } = fakePg(() => []);
  assert.equal(await resolveSession(pg, mintSessionToken(), new Date()), undefined);
});

test("revoking by id is scoped to the owner in the SQL itself", async () => {
  const { pg, calls } = fakePg(() => []);
  const revoked = await revokeSessionById(pg, {
    id: "sises_other",
    customerId: "cus_1",
    reason: "revoked_by_customer",
    now: new Date(),
  });
  assert.equal(revoked, 0);
  assert.match(calls[0]!.sql, /WHERE id = \? AND customer_id = \?/);
});

test("sign out everywhere counts what it revoked", async () => {
  const { pg } = fakePg(() => [{ id: "a" }, { id: "b" }, { id: "c" }]);
  assert.equal(
    await revokeAllSessions(pg, { customerId: "cus_1", reason: "signout_everywhere", now: new Date() }),
    3,
  );
});

test("an auth event write never throws", async () => {
  const pg: SqlClient = {
    async raw() {
      throw new Error("relation siumora_auth_event does not exist");
    },
  };
  assert.equal(await recordAuthEvent(pg, { type: "otp_sent", channel: "whatsapp" }), false);
});

// ── Privacy requests (phase 2) ──────────────────────────────────────────


test("an erasure request already open is returned, not duplicated", async () => {
  const open = {
    id: "sipr_1",
    customer_id: "cus_1",
    kind: "erasure",
    status: "acknowledged",
    note: "1 order is still in progress",
    resolve_by: "2026-11-09T00:00:00.000Z",
    completed_at: null,
    created_at: "2026-10-10T00:00:00.000Z",
  };
  const { pg, calls } = fakePg(() => [open]);
  const result = await openPrivacyRequest(pg, { customerId: "cus_1", kind: "erasure", now: new Date() });
  assert.equal(result.existing, true);
  assert.equal(result.request.id, "sipr_1");
  assert.equal(calls.length, 1, "no insert");
});

test("a new request gets the 30-day statutory deadline", async () => {
  const now = new Date("2026-10-10T00:00:00Z");
  let inserted: readonly unknown[] = [];
  const { pg } = fakePg((sql, bindings) => {
    if (sql.startsWith("INSERT")) {
      inserted = bindings;
      return [{ id: bindings[0], resolve_by: bindings[3] }];
    }
    return [];
  });
  const result = await openPrivacyRequest(pg, { customerId: "cus_1", kind: "erasure", now });
  assert.equal(result.existing, false);
  assert.equal(inserted[3], "2026-11-09T00:00:00.000Z");
});

// ── Sign-in health (phase 3) ────────────────────────────────────────────


test("health turns event counts into the funnel and per-channel delivery", () => {
  const health = summariseHealth([
    { type: "otp_sent", channel: "whatsapp", count: "80" },
    { type: "otp_send_failed", channel: "whatsapp", count: "20" },
    { type: "otp_sent", channel: "sms", count: 20 },
    { type: "otp_verified", channel: null, count: 90 },
    { type: "otp_failed", channel: null, count: 12 },
    { type: "otp_rate_limited", channel: null, count: 7 },
    { type: "signin_completed", channel: null, count: 88 },
  ]);
  assert.equal(health.sent, 100);
  assert.equal(health.requested, 120);
  assert.equal(health.verifyRate, 0.9);
  assert.equal(health.failedCodes, 12);
  assert.equal(health.rateLimited, 7);
  assert.deepEqual(health.channels, [
    { channel: "sms", sent: 20, failed: 0, deliveryRate: 1 },
    { channel: "whatsapp", sent: 80, failed: 20, deliveryRate: 0.8 },
  ]);
});

test("no traffic is no rate, not zero", () => {
  const health = summariseHealth([]);
  assert.equal(health.verifyRate, null);
  assert.deepEqual(health.channels, []);
  assert.equal(healthWindow("7d"), "7d");
  assert.equal(healthWindow("forever"), "24h");
});
