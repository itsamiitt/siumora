import assert from "node:assert/strict";
import { test } from "node:test";

import type { CartTotals } from "./cart.ts";
import {
  invoiceSeriesHealth,
  ndrQueue,
  rtoBreakdown,
  statusCounts,
  summariseRevenue,
} from "./metrics.ts";
import type { Order, OrderStatus, PaymentMethod } from "./order.ts";

function totals(total: number): CartTotals {
  return {
    mrpTotal: total,
    subtotal: total,
    savings: 0,
    shipping: 0,
    codFee: 0,
    total,
    gst: { taxableValue: total, cgst: 0, sgst: 0, igst: 0, totalTax: 0, total },
    itemCount: 1,
  };
}

let counter = 0;
function order(
  status: OrderStatus,
  total = 100000,
  extra: Partial<Order> = {},
): Order {
  counter += 1;
  return {
    id: `o${counter}`,
    number: `SIU-${String(counter).padStart(5, "0")}`,
    status,
    lines: [],
    totals: totals(total),
    paymentMethod: "upi" as PaymentMethod,
    address: {
      name: "A",
      phone: "9876543210",
      line1: "x",
      city: "Mumbai",
      stateCode: "27",
      pincode: "400001",
    },
    interState: false,
    placedAt: "2026-07-01T00:00:00Z",
    eventId: `e${counter}`,
    ...extra,
  };
}

test("does not count a parcel in transit as revenue", () => {
  // This is the trap: booking a COD order as revenue before delivery is how
  // RTO silently inflates the books.
  const summary = summariseRevenue([
    order("delivered", 100000),
    order("shipped", 200000),
  ]);

  assert.equal(summary.recognised, 100000);
  assert.equal(summary.booked, 300000);
  assert.equal(summary.inFlight, 200000);
});

test("separates value lost to returns from value in flight", () => {
  const summary = summariseRevenue([
    order("delivered", 100000),
    order("rto", 50000),
    order("cancelled", 30000),
    order("out_for_delivery", 20000),
  ]);

  assert.equal(summary.recognised, 100000);
  assert.equal(summary.lost, 80000);
  assert.equal(summary.inFlight, 20000);
  // The three buckets always account for every booked rupee.
  assert.equal(
    summary.recognised + summary.lost + summary.inFlight,
    summary.booked,
  );
});

test("reports no AOV rather than zero when there are no orders", () => {
  const summary = summariseRevenue([]);
  assert.equal(summary.aov, null);
  assert.equal(summary.booked, 0);
});

test("averages order value across booked orders", () => {
  const summary = summariseRevenue([
    order("delivered", 100000),
    order("shipped", 200000),
  ]);
  assert.equal(summary.aov, 150000);
});

test("excludes in-transit orders from the RTO denominator", () => {
  // Counting undecided parcels as successes makes every lane look good.
  const orders = [
    order("delivered", 1000, { address: { ...order("delivered").address, pincode: "400001" } }),
    order("rto", 1000, { address: { ...order("rto").address, pincode: "400001" } }),
    order("shipped", 1000, { address: { ...order("shipped").address, pincode: "400001" } }),
  ];

  const [row] = rtoBreakdown(orders, (o) => o.address.pincode);
  assert.equal(row?.orders, 2, "in-transit order should not be counted");
  assert.equal(row?.returned, 1);
  assert.equal(row?.rate, 0.5);
});

test("ranks the worst lanes first", () => {
  const at = (pincode: string, status: OrderStatus) =>
    order(status, 1000, {
      address: { ...order(status).address, pincode },
    });

  const rows = rtoBreakdown(
    [
      at("110001", "rto"),
      at("110001", "rto"),
      at("400001", "delivered"),
      at("400001", "delivered"),
    ],
    (o) => o.address.pincode,
  );

  assert.equal(rows[0]?.key, "110001");
  assert.equal(rows[0]?.rate, 1);
  assert.equal(rows[1]?.rate, 0);
});

test("returns nothing when no order has settled", () => {
  assert.deepEqual(rtoBreakdown([order("shipped")], (o) => o.address.pincode), []);
});

test("queues failed deliveries with the most attempts first", () => {
  const queue = ndrQueue([
    order("ndr", 1000, { deliveryAttempts: 1 }),
    order("ndr", 1000, { deliveryAttempts: 3 }),
    order("delivered"),
  ]);

  assert.equal(queue.length, 2);
  assert.equal(queue[0]?.deliveryAttempts, 3);
});

test("counts orders by status", () => {
  const counts = statusCounts([
    order("delivered"),
    order("delivered"),
    order("rto"),
  ]);
  assert.equal(counts.delivered, 2);
  assert.equal(counts.rto, 1);
});

test("reports a healthy invoice series", () => {
  const health = invoiceSeriesHealth([
    order("delivered", 1000, { invoiceNumber: "SIU/2026-27/000001" }),
    order("delivered", 1000, { invoiceNumber: "SIU/2026-27/000002" }),
  ]);
  assert.equal(health.healthy, true);
  assert.equal(health.issued, 2);
});

test("flags a gap in the invoice series", () => {
  // A gap is what an assessing officer asks about, so it has to surface the
  // day it appears rather than at filing.
  const health = invoiceSeriesHealth([
    order("delivered", 1000, { invoiceNumber: "SIU/2026-27/000001" }),
    order("delivered", 1000, { invoiceNumber: "SIU/2026-27/000003" }),
  ]);
  assert.equal(health.healthy, false);
  assert.deepEqual(health.gaps, [2]);
});

test("treats an empty series as healthy", () => {
  const health = invoiceSeriesHealth([order("pending_payment")]);
  assert.equal(health.healthy, true);
  assert.equal(health.issued, 0);
});
