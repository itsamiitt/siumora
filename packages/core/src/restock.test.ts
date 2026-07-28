import assert from "node:assert/strict";
import { test } from "node:test";

import { ORDER_STATUSES, canTransition, type OrderStatus } from "./order.ts";
import { awaitsRestock, restockTiming } from "./restock.ts";

test("puts stock back at once when the goods never left", () => {
  for (const from of [
    "pending_payment",
    "awaiting_cod_confirmation",
    "confirmed",
    "processing",
  ] as OrderStatus[]) {
    assert.equal(restockTiming(from, "cancelled"), "immediate", from);
  }
});

test("waits for the parcel when it is already with a courier", () => {
  // Cancelling out of a failed delivery leaves the goods in a van. Counting
  // them as sellable promises a piece that is days away and may be damaged.
  assert.equal(restockTiming("ndr", "cancelled"), "on-receipt");
});

test("a parcel returning is not stock until somebody has it", () => {
  assert.equal(restockTiming("shipped", "rto"), "on-receipt");
  assert.equal(restockTiming("ndr", "rto"), "on-receipt");
  assert.equal(restockTiming("delivered", "returned"), "on-receipt");
});

test("a live order yields nothing back", () => {
  for (const to of [
    "confirmed",
    "processing",
    "shipped",
    "out_for_delivery",
    "delivered",
    "ndr",
  ] as OrderStatus[]) {
    assert.equal(restockTiming("confirmed", to), "none", to);
  }
});

test("every legal transition has a timing", () => {
  // A move the state machine allows but this function has no answer for would
  // silently leak stock, which is exactly the bug this file exists to close.
  for (const from of ORDER_STATUSES) {
    for (const to of ORDER_STATUSES) {
      if (!canTransition(from, to)) continue;
      assert.ok(
        ["immediate", "on-receipt", "none"].includes(restockTiming(from, to)),
        `${from} -> ${to}`,
      );
    }
  }
});

test("every ending that owes stock is marked as owing it", () => {
  for (const from of ORDER_STATUSES) {
    for (const to of ORDER_STATUSES) {
      if (!canTransition(from, to)) continue;
      if (restockTiming(from, to) === "none") continue;
      assert.equal(awaitsRestock(to), true, `${from} -> ${to}`);
    }
  }
});
