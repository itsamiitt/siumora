import assert from "node:assert/strict";
import { test } from "node:test";

import { claimRequest, claimableView, taxFields } from "./account-view.ts";
import { addressKey, decideCodGate, type CodGateInput } from "./cod-gate.ts";
import { ownsOrder } from "./identity.ts";
import { claimOrders, setOwnerIfUnowned, unownedIdentities, type SqlClient } from "./ownership.ts";

// ── The COD gate ────────────────────────────────────────────────────────

const SIGNED_IN: CodGateInput = {
  codRequiresOtp: true,
  signedInPhone: "9812345678",
  orderPhone: "9812345678",
  totalPaise: 199000,
  stepUpAbove: 300000,
  isNewAddress: true,
  stepUpFresh: false,
};

test("COD to the verified phone passes", () => {
  assert.deepEqual(decideCodGate(SIGNED_IN), { ok: true });
});

test("COD signed out, or to a different number, asks to verify the delivery phone", () => {
  const signedOut = decideCodGate({ ...SIGNED_IN, signedInPhone: undefined });
  assert.equal(signedOut.ok, false);
  assert.equal(!signedOut.ok && signedOut.body.error, "verify_phone");

  const otherPhone = decideCodGate({ ...SIGNED_IN, orderPhone: "9800000000" });
  assert.equal(!otherPhone.ok && otherPhone.body.error, "verify_phone");
});

test("a large COD order to a new address needs a fresh code, not just a session", () => {
  const large = { ...SIGNED_IN, totalPaise: 450000 };
  const refused = decideCodGate(large);
  assert.equal(!refused.ok && refused.body.error, "step_up_required");
  assert.deepEqual(decideCodGate({ ...large, stepUpFresh: true }), { ok: true });
  assert.deepEqual(decideCodGate({ ...large, isNewAddress: false }), { ok: true }, "known address");
  assert.deepEqual(decideCodGate({ ...large, totalPaise: 300000 }), { ok: true }, "at the threshold is not above it");
});

test("the settings lever opens the gate entirely", () => {
  assert.deepEqual(decideCodGate({ ...SIGNED_IN, codRequiresOtp: false, signedInPhone: undefined }), { ok: true });
});

test("addresses compare on pincode and a squeezed first line", () => {
  assert.equal(
    addressKey({ postal_code: "411001", address_1: "Flat 4B, Rose Villa" }),
    addressKey({ postal_code: " 411001 ", address_1: "flat 4b rose-villa" }),
  );
  assert.notEqual(
    addressKey({ postal_code: "411001", address_1: "Flat 4B" }),
    addressKey({ postal_code: "411002", address_1: "Flat 4B" }),
  );
  assert.equal(addressKey({ postal_code: "", address_1: "x" }), undefined);
  assert.equal(addressKey(null), undefined);
});

// ── Ownership ───────────────────────────────────────────────────────────

test("an order is the actor's when the identity or the Medusa order says so", () => {
  assert.equal(ownsOrder("cus_1", { customer_id: "cus_1" }, { customer_id: "cus_guest" }), true);
  assert.equal(ownsOrder("cus_1", { customer_id: null }, { customer_id: "cus_1" }), true);
  assert.equal(ownsOrder("cus_1", { customer_id: "cus_2" }, { customer_id: null }), false);
  assert.equal(ownsOrder(undefined, { customer_id: null }, { customer_id: null }), false, "null never equals anonymous");
});

function fakePg(rows: unknown[] = []) {
  const calls: Array<{ sql: string; bindings: readonly unknown[] }> = [];
  const pg: SqlClient = {
    async raw(sql, bindings = []) {
      calls.push({ sql, bindings });
      return { rows };
    },
  };
  return { pg, calls };
}

test("setting the owner never overwrites one", async () => {
  const { pg, calls } = fakePg();
  await setOwnerIfUnowned(pg, "order_1", "cus_1");
  assert.match(calls[0]!.sql, /customer_id IS NULL/);
});

test("a claim only takes unowned orders and counts what it took", async () => {
  const { pg, calls } = fakePg([{ id: "a" }]);
  assert.equal(await claimOrders(pg, ["order_1", "order_2"], "cus_1", new Date()), 1);
  assert.match(calls[0]!.sql, /customer_id IS NULL/);
  assert.deepEqual(calls[0]!.bindings.slice(3), ["order_1", "order_2"]);
});

test("empty lists never reach the database", async () => {
  const { pg, calls } = fakePg();
  assert.deepEqual(await unownedIdentities(pg, []), []);
  assert.equal(await claimOrders(pg, [], "cus_1", new Date()), 0);
  assert.equal(calls.length, 0);
});

// ── "Is this your order?" ───────────────────────────────────────────────

test("a claimable order is shown thinly: number, date, pieces, total, city", () => {
  const view = claimableView({
    orderNumber: "SIU-00042",
    placedAt: "2026-09-01T10:00:00Z",
    lines: [
      { quantity: 2, unitPrice: 99000 },
      { quantity: 1, unitPrice: 149000 },
    ],
    shipping: 0,
    city: " Pune ",
  });
  assert.deepEqual(view, {
    number: "SIU-00042",
    placedAt: "2026-09-01T10:00:00.000Z",
    itemCount: 3,
    total: 347000,
    city: "Pune",
  });
  assert.deepEqual(Object.keys(view).sort(), ["city", "itemCount", "number", "placedAt", "total"]);
});

test("a claim request takes well-formed numbers only, deduplicated", () => {
  assert.deepEqual(claimRequest({ numbers: ["SIU-00001", "SIU-00001", "SIU-00002"] }), ["SIU-00001", "SIU-00002"]);
  assert.equal(claimRequest({ numbers: [] }), undefined);
  assert.equal(claimRequest({ numbers: ["SIU-1; DROP"] }), undefined);
  assert.equal(claimRequest({}), undefined);
  assert.equal(claimRequest({ numbers: Array.from({ length: 51 }, (_, i) => `SIU-${10000 + i}`) }), undefined);
});

test("the order list's tax split prefers the stored invoice", () => {
  const stored = taxFields([], { taxableValue: 100, cgst: 3, sgst: 3, igst: 0 }, "27");
  assert.equal(stored.taxableValue, 100);
  assert.equal(stored.cgst, 3);
});

test("without an invoice the split is computed, and a slab-less line yields zeros", () => {
  const line = { unitPrice: 105000, mrp: 105000, quantity: 1, gstSlab: 5, hsn: "7117" };
  const computed = taxFields([line], null, "29");
  assert.equal(computed.interState, true);
  assert.equal(computed.cgst + computed.sgst, 0);
  assert.ok(computed.igst > 0);
  assert.equal(computed.taxableValue + computed.igst, 105000);

  const unknown = taxFields([{ ...line, gstSlab: null }], null, "29");
  assert.deepEqual([unknown.taxableValue, unknown.igst], [0, 0]);
});
