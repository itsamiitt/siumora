import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEDUCTION_ALARM_RATIO,
  cashPosition,
  overDeducted,
  reconcileRemittance,
  type ExpectedOrder,
  type RemittanceRow,
} from "./remittance.ts";

const INVOICE = 193900;

function row(overrides: Partial<RemittanceRow> = {}): RemittanceRow {
  return {
    orderNumber: "SIU-00001",
    collected: INVOICE,
    deductions: 6500,
    remitted: INVOICE - 6500,
    ...overrides,
  };
}

function order(overrides: Partial<ExpectedOrder> = {}): ExpectedOrder {
  return {
    orderNumber: "SIU-00001",
    total: INVOICE,
    paymentMethod: "cod",
    status: "delivered",
    ...overrides,
  };
}

test("passes a row that collected exactly the invoice", () => {
  const result = reconcileRemittance([row()], [order()]);
  assert.equal(result.rows[0]?.outcome, "matched");
  assert.equal(result.rows[0]?.variance, 0);
  assert.equal(result.exceptions.length, 0);
});

test("flags a shortfall as money to chase", () => {
  const result = reconcileRemittance(
    [row({ collected: INVOICE - 4900 })],
    [order()],
  );
  assert.equal(result.rows[0]?.outcome, "short");
  assert.equal(result.rows[0]?.variance, -4900);
  assert.equal(result.shortfall, 4900);
});

test("flags an overcollection too", () => {
  // Not a windfall — the customer was overcharged at the door.
  const result = reconcileRemittance(
    [row({ collected: INVOICE + 10000 })],
    [order()],
  );
  assert.equal(result.rows[0]?.outcome, "over");
  assert.equal(result.shortfall, 0);
});

test("does not mistake the courier's deduction for a shortfall", () => {
  // The remitted amount is *supposed* to be lower — that gap is freight and
  // the COD charge. Comparing remitted against the invoice would report every
  // single row as short.
  const result = reconcileRemittance(
    [row({ collected: INVOICE, deductions: 6500, remitted: INVOICE - 6500 })],
    [order()],
  );
  assert.equal(result.rows[0]?.outcome, "matched");
  assert.equal(result.deductions, 6500);
  assert.equal(result.remitted, INVOICE - 6500);
});

test("refuses a row for an order that does not exist", () => {
  const result = reconcileRemittance([row({ orderNumber: "SIU-99999" })], []);
  assert.equal(result.rows[0]?.outcome, "unknown_order");
  assert.equal(result.rows[0]?.expected, 0);
});

test("refuses a collection against a prepaid order", () => {
  const result = reconcileRemittance(
    [row()],
    [order({ paymentMethod: "upi" })],
  );
  assert.equal(result.rows[0]?.outcome, "not_cod");
});

test("refuses a collection on a parcel that was never delivered", () => {
  const result = reconcileRemittance([row()], [order({ status: "shipped" })]);
  assert.equal(result.rows[0]?.outcome, "not_delivered");
  assert.match(result.rows[0]?.note ?? "", /shipped/);
});

test("catches the same order listed twice in one file", () => {
  const result = reconcileRemittance([row(), row()], [order()]);
  assert.equal(result.rows[0]?.outcome, "matched");
  assert.equal(result.rows[1]?.outcome, "duplicate");
  // Crediting both would book the sale twice, so the duplicate contributes
  // nothing to the expected total.
  assert.equal(result.expected, INVOICE);
  assert.equal(result.rows[1]?.expected, 0);
});

test("catches an order already reconciled in an earlier batch", () => {
  const result = reconcileRemittance(
    [row()],
    [order({ alreadyReconciled: true })],
  );
  assert.equal(result.rows[0]?.outcome, "duplicate");
});

test("works the queue worst first", () => {
  const result = reconcileRemittance(
    [
      row({ orderNumber: "A", collected: INVOICE + 100 }),
      row({ orderNumber: "B", collected: INVOICE - 100 }),
      row({ orderNumber: "C" }),
      row({ orderNumber: "D" }),
    ],
    [
      order({ orderNumber: "A" }),
      order({ orderNumber: "B" }),
      order({ orderNumber: "C", status: "shipped" }),
      order({ orderNumber: "D" }),
    ],
  );

  // Money missing outranks a keying error, which outranks nothing.
  assert.deepEqual(
    result.exceptions.map((entry) => entry.outcome),
    ["short", "not_delivered", "over"],
  );
});

test("counts every outcome, including the ones that did not happen", () => {
  const result = reconcileRemittance([row()], [order()]);
  // A zero is information: an operator scanning the counts should not have to
  // wonder whether "short" is absent or simply missing from the object.
  assert.equal(result.counts.matched, 1);
  assert.equal(result.counts.short, 0);
  assert.equal(result.counts.unknown_order, 0);
});

test("spots a parcel billed on more weight than it was booked at", () => {
  const result = reconcileRemittance(
    [row({ declaredWeightGrams: 200, chargedWeightGrams: 500 })],
    [order()],
  );
  assert.equal(result.weightDisputes.length, 1);
  assert.equal(result.weightDisputes[0]?.excessWeightGrams, 300);
});

test("does not invent a dispute when the courier billed less", () => {
  const result = reconcileRemittance(
    [row({ declaredWeightGrams: 500, chargedWeightGrams: 200 })],
    [order()],
  );
  assert.equal(result.weightDisputes.length, 0);
  assert.equal(result.rows[0]?.excessWeightGrams, 0);
});

test("flags an implausible deduction", () => {
  const fine = row({ collected: 100000, deductions: 20000 });
  const steep = row({ collected: 100000, deductions: 40000 });

  assert.deepEqual(overDeducted([fine, steep]), [steep]);
  assert.ok(DEDUCTION_ALARM_RATIO > 0.2 && DEDUCTION_ALARM_RATIO < 0.5);
});

test("ignores a zero-collection row when judging deductions", () => {
  // Dividing by zero would report Infinity and put a row nobody collected on
  // at the top of the dispute list.
  assert.deepEqual(overDeducted([row({ collected: 0, deductions: 100 })]), []);
});

test("separates cash the shop has from cash somebody else is holding", () => {
  const position = cashPosition([
    { total: 100000, paymentMethod: "upi", status: "delivered" },
    { total: 200000, paymentMethod: "cod", status: "shipped" },
    { total: 300000, paymentMethod: "cod", status: "delivered" },
    { total: 400000, paymentMethod: "cod", status: "delivered", reconciled: true },
  ]);

  assert.equal(position.prepaidSettled, 100000);
  assert.equal(position.codInTransit, 200000);
  // Revenue on the books, nothing in the bank. The number a shop plans against
  // if it cannot see it.
  assert.equal(position.codAwaitingRemittance, 300000);
  assert.equal(position.codRemitted, 400000);
});

test("counts a COD parcel in NDR as still in transit", () => {
  // It has not come back and it has not been paid for.
  const position = cashPosition([
    { total: 100000, paymentMethod: "cod", status: "ndr" },
  ]);
  assert.equal(position.codInTransit, 100000);
});

test("counts nothing for an order that ended without delivery", () => {
  const position = cashPosition([
    { total: 100000, paymentMethod: "cod", status: "rto" },
    { total: 100000, paymentMethod: "cod", status: "cancelled" },
    { total: 100000, paymentMethod: "upi", status: "cancelled" },
  ]);
  assert.deepEqual(position, {
    prepaidSettled: 0,
    codInTransit: 0,
    codAwaitingRemittance: 0,
    codRemitted: 0,
  });
});

test("an empty file reconciles to zero rather than throwing", () => {
  const result = reconcileRemittance([], [order()]);
  assert.equal(result.rows.length, 0);
  assert.equal(result.collected, 0);
  assert.equal(result.shortfall, 0);
});
