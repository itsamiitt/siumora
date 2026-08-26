import { test } from "node:test";
import assert from "node:assert/strict";

import { parseRemittanceBatch } from "./batch.ts";

// The hand-rolled twin of the Fastify batchSchema
// (apps/api/src/routes/remittance.ts): same fields, same bounds, same
// defaults, worded refusals.

const ROW = { orderNumber: "SIU-00001", collected: 199000, remitted: 190000 };

test("a well-formed batch parses, deductions defaulting to zero", () => {
  const parsed = parseRemittanceBatch({
    batchId: " UTR-1 ",
    courier: "delhivery",
    rows: [ROW],
  });
  assert.ok(parsed.ok);
  assert.equal(parsed.value.batchId, "UTR-1");
  assert.equal(parsed.value.rows[0]!.deductions, 0);
  assert.equal(parsed.value.remittedOn, undefined);
});

test("remittedOn parses as a date; garbage is refused", () => {
  const ok = parseRemittanceBatch({
    batchId: "b",
    courier: "c",
    remittedOn: "2026-08-20T00:00:00.000Z",
    rows: [ROW],
  });
  assert.ok(ok.ok);
  assert.equal(ok.value.remittedOn?.toISOString(), "2026-08-20T00:00:00.000Z");

  const bad = parseRemittanceBatch({
    batchId: "b",
    courier: "c",
    remittedOn: "yesterday-ish",
    rows: [ROW],
  });
  assert.ok(!bad.ok);
});

test("negative remitted is legal — a clawback nets below zero", () => {
  const parsed = parseRemittanceBatch({
    batchId: "b",
    courier: "c",
    rows: [{ ...ROW, remitted: -5000 }],
  });
  assert.ok(parsed.ok);
});

test("negative collected is not — cash at the door cannot be negative", () => {
  const parsed = parseRemittanceBatch({
    batchId: "b",
    courier: "c",
    rows: [{ ...ROW, collected: -1 }],
  });
  assert.ok(!parsed.ok);
  assert.match(parsed.message, /collected/);
});

test("fractional paise are a typo, refused with the row named", () => {
  const parsed = parseRemittanceBatch({
    batchId: "b",
    courier: "c",
    rows: [ROW, { ...ROW, collected: 100.5 }],
  });
  assert.ok(!parsed.ok);
  assert.match(parsed.message, /rows\[1\]\.collected/);
});

test("an empty batch and an oversize batch are both refused", () => {
  assert.ok(!parseRemittanceBatch({ batchId: "b", courier: "c", rows: [] }).ok);
  assert.ok(
    !parseRemittanceBatch({
      batchId: "b",
      courier: "c",
      rows: Array.from({ length: 2001 }, () => ROW),
    }).ok,
  );
});

test("a blank batchId or courier is refused — the batch id is the idempotency key", () => {
  assert.ok(!parseRemittanceBatch({ batchId: "  ", courier: "c", rows: [ROW] }).ok);
  assert.ok(!parseRemittanceBatch({ batchId: "b", courier: "", rows: [ROW] }).ok);
});
