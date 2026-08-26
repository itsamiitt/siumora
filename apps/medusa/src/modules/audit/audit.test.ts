import { test } from "node:test";
import assert from "node:assert/strict";

import { auditEntry, maskActorContact, type AuditRow } from "./audit.ts";

// The masking contract (parity row: "shows an operator the log without the
// phone numbers"): full contacts live in the table for accountability, and
// every read passes through here.

test("a phone masks through core's recipe — first two and last four survive", () => {
  assert.equal(maskActorContact("9000000001"), "90••••0001");
});

test("anything that is not a 10-digit phone collapses entirely", () => {
  assert.equal(maskActorContact("+919000000001"), "••••");
  assert.equal(maskActorContact(""), "••••");
});

test("an email keeps its first character and its domain, nothing between", () => {
  assert.equal(maskActorContact("admin@siumora.dev"), "a…@siumora.dev");
});

test("the entry envelope is camelCase and always masked", () => {
  const row: AuditRow = {
    id: "siaud_1",
    actor_id: "user_1",
    actor_contact: "admin@siumora.dev",
    actor_role: "owner",
    action: "settings.update",
    subject: "payments_enabled",
    detail: { value: false },
    ip: "127.0.0.1",
    created_at: "2026-08-26T00:00:00.000Z",
  };
  assert.deepEqual(auditEntry(row), {
    id: "siaud_1",
    actorId: "user_1",
    actorPhone: "a…@siumora.dev",
    actorRole: "owner",
    action: "settings.update",
    subject: "payments_enabled",
    detail: { value: false },
    ip: "127.0.0.1",
    createdAt: "2026-08-26T00:00:00.000Z",
  });
});
