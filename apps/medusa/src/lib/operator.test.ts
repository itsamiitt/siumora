import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NOT_AN_OPERATOR,
  NOT_SIGNED_IN,
  decidePermission,
  decideRole,
  insufficientRole,
} from "./operator.ts";

// The gate's decisions, pinned against the Fastify requirePermission ladder
// (apps/api/src/lib/auth.ts): same envelopes, same allow-list semantics
// (packages/core rbac — parseAdminRoles/roleFor/can are core's and tested
// there; what is pinned here is how THIS gate arranges core's answers).

// ── Role resolution ───────────────────────────────────────────

test("an emailpass dashboard user is an owner — stated, not pretended", () => {
  const decision = decideRole({ actorType: "user", contact: "ops@siumora.dev" }, {});
  assert.ok(decision.ok);
  assert.equal(decision.role, "owner");
  // Owners hold every permission, including the statutory desks.
  assert.ok(decision.permissions.includes("gst:read"));
  assert.ok(decision.permissions.includes("settings:write"));
});

test("a customer on the allow-list gets the role the list assigns", () => {
  const decision = decideRole(
    { actorType: "customer", contact: "9000000001" },
    { ADMIN_PHONES: "9000000001:operator" },
  );
  assert.ok(decision.ok);
  assert.equal(decision.role, "operator");
  assert.ok(decision.permissions.includes("orders:write"));
  assert.ok(!decision.permissions.includes("gst:read"));
});

test("an unsuffixed allow-list number is an owner (the one-person shop)", () => {
  const decision = decideRole(
    { actorType: "customer", contact: "9000000001" },
    { ADMIN_PHONES: "9000000001" },
  );
  assert.ok(decision.ok);
  assert.equal(decision.role, "owner");
});

test("a customer off the list is refused as a known person — 403, not 404", () => {
  const decision = decideRole(
    { actorType: "customer", contact: "9999999999" },
    { ADMIN_PHONES: "9000000001" },
  );
  assert.ok(!decision.ok);
  assert.deepEqual(decision.refusal, NOT_AN_OPERATOR);
});

test("a customer with no stored phone is refused, never crashed on", () => {
  const decision = decideRole(
    { actorType: "customer", contact: null },
    { ADMIN_PHONES: "9000000001" },
  );
  assert.ok(!decision.ok);
  assert.equal(decision.refusal.code, 403);
});

test("an empty allow-list refuses every customer", () => {
  const decision = decideRole({ actorType: "customer", contact: "9000000001" }, {});
  assert.ok(!decision.ok);
});

// ── Permission check ──────────────────────────────────────────

test("a viewer may read metrics and nothing else", () => {
  assert.ok(decidePermission("viewer", "metrics:read").ok);
  const refused = decidePermission("viewer", "orders:write");
  assert.ok(!refused.ok);
  assert.equal(refused.refusal.code, 403);
  assert.equal(refused.refusal.body.error, "insufficient_role");
  // The refusal names the permission — an operator told only "no" goes and
  // asks an owner to try it too, which is two people's time for one fact.
  assert.equal(refused.refusal.body.needs, "orders:write");
});

test("the refusal wording matches the Fastify gate, article and all", () => {
  assert.equal(
    insufficientRole("operator", "gst:read").body.message,
    "An operator cannot do this. Needs: gst:read.",
  );
  assert.equal(
    insufficientRole("viewer", "audit:read").body.message,
    "A viewer cannot do this. Needs: audit:read.",
  );
});

// ── Envelopes ─────────────────────────────────────────────────

test("the anonymous refusal is the Fastify 401, verbatim", () => {
  assert.equal(NOT_SIGNED_IN.code, 401);
  assert.deepEqual(NOT_SIGNED_IN.body, {
    error: "not_signed_in",
    message: "Sign in to continue.",
  });
});

test("the carried contact normalises a +91 phone so the audit mask works", async () => {
  const { operatorContact } = await import("./operator.ts");
  assert.equal(operatorContact("customer", "+919000000001"), "9000000001");
  assert.equal(operatorContact("customer", null), "");
  assert.equal(operatorContact("user", "admin@siumora.dev"), "admin@siumora.dev");
});
