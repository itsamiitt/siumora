import assert from "node:assert/strict";
import { test } from "node:test";

import { joinWaitlist, listWaitlist, parseSignup, type SqlClient } from "./data.ts";

test("signups are normalized and invalid personal data is rejected", () => {
  assert.deepEqual(parseSignup({ name: "  Asha  ", email: " ASHA@Example.com " }),
    { name: "Asha", email: "asha@example.com" });
  assert.equal(parseSignup({ name: " ", email: "asha@example.com" }), undefined);
  assert.equal(parseSignup({ name: "Asha", email: "invalid" }), undefined);
  assert.equal(parseSignup({ name: "Asha", email: "a".repeat(255) }), undefined);
});

test("writes use bound values and duplicate-safe insert; reads are paged", async () => {
  const calls: Array<{ sql: string; bindings: ReadonlyArray<string | number> }> = [];
  const pg: SqlClient = { async raw(sql, bindings) {
    calls.push({ sql, bindings });
    return { rows: sql.startsWith("select") ? [{ id: "one", name: "Asha", email: "asha@example.com", created_at: "2026-10-09T00:00:00.000Z", customer_id: "cus_1", order_count: "2", latest_order_id: "order_2" }] : [] };
  } };
  await joinWaitlist(pg, { name: "Asha", email: "asha@example.com" });
  assert.match(calls[0]!.sql, /on conflict \(email\) do nothing/);
  assert.deepEqual(calls[0]!.bindings.slice(1), ["Asha", "asha@example.com"]);
  const result = await listWaitlist(pg, 2);
  assert.equal(result.entries[0]?.email, "asha@example.com");
  assert.equal(result.entries[0]?.customerId, "cus_1");
  assert.equal(result.entries[0]?.orderCount, 2);
  assert.equal(result.entries[0]?.latestOrderId, "order_2");
  assert.deepEqual(calls[1]!.bindings, [51, 100]);
});
