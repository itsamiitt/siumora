import { test } from "node:test";
import assert from "node:assert/strict";

import { ShiprocketFulfillmentProviderService } from "./service.ts";

// The provider against a scripted Shiprocket and an in-memory stand-in for
// the four statements it runs (identity lookup, shipment read/upsert, status
// row). Credentials from the environment — no Postgres settings table here,
// so credentials.ts reads env when the settings query fails.
process.env.SHIPROCKET_EMAIL = "ops@siumora.in";
process.env.SHIPROCKET_PASSWORD = "pw";

type Answer = { status: number; body: unknown };

function scripted(routes: Record<string, Answer[]>) {
  const calls: string[] = [];
  const bodies: Record<string, unknown> = {};
  const seen: Record<string, number> = {};
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${new URL(String(url)).pathname.replace("/v1/external", "")}`;
    calls.push(key);
    if (typeof init?.body === "string") bodies[key] = JSON.parse(init.body);
    const list = routes[key] ?? [{ status: 404, body: {} }];
    const answer = list[Math.min(seen[key] ?? 0, list.length - 1)]!;
    seen[key] = (seen[key] ?? 0) + 1;
    return { ok: answer.status < 300, status: answer.status, text: async () => JSON.stringify(answer.body) };
  }) as unknown as typeof fetch;
  return { impl, calls, bodies };
}

function fakePg() {
  const shipments = new Map<string, Record<string, unknown>>();
  const statuses = new Map<string, string>();
  // The order's recorded payments (siumora-order/payment-method.ts).
  const payments: Array<{ id: string; provider_id: string }> = [];
  return {
    shipments,
    statuses,
    payments,
    async raw(sql: string, bindings: ReadonlyArray<unknown> = []) {
      if (sql.includes("siumora_settings")) throw new Error("no settings table in a unit test");
      if (sql.includes("FROM order_payment_collection")) return { rows: payments };
      if (sql.includes("FROM siumora_order_identity")) return { rows: [{ order_number: "SIU-00042" }] };
      if (sql.startsWith("SELECT") && sql.includes("FROM siumora_shipments WHERE order_id")) {
        const row = shipments.get(String(bindings[0]));
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("INSERT INTO siumora_shipments")) {
        const [id, orderId, courierOrderId, shipmentId, awb, courier, pickup] = bindings;
        const current = shipments.get(String(orderId)) ?? { id, order_id: orderId, pickup_scheduled: false };
        const next = {
          ...current,
          courier_order_id: courierOrderId ?? current.courier_order_id ?? null,
          shipment_id: shipmentId ?? current.shipment_id ?? null,
          awb: awb ?? current.awb ?? null,
          courier: courier ?? current.courier ?? null,
          pickup_scheduled: Boolean(current.pickup_scheduled) || Boolean(pickup),
        };
        shipments.set(String(orderId), next);
        return { rows: [next] };
      }
      if (sql.includes("INSERT INTO siumora_order_status")) {
        const [, orderId, initial] = bindings;
        if (!statuses.has(String(orderId))) statuses.set(String(orderId), String(initial));
        return { rows: [{ order_id: orderId, status: statuses.get(String(orderId)), ndr_reason: null }] };
      }
      if (sql.includes("UPDATE siumora_order_status")) {
        const [status, , orderId] = bindings;
        statuses.set(String(orderId), String(status));
        return { rows: [{ order_id: orderId, status, ndr_reason: null }] };
      }
      throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
    },
  };
}

const ORDER = {
  id: "order_1",
  status: "pending",
  created_at: "2026-10-25T08:00:00.000Z",
  metadata: { siumora_payment_method: "upi" },
  shipping_address: {
    first_name: "Asha",
    last_name: "Menon",
    phone: "9876543210",
    address_1: "Flat 3B, Sunrise Apartments",
    city: "Mumbai",
    province: "27",
    postal_code: "400001",
  },
  items: [{ id: "item_1", title: "Petal Studs", variant_sku: "SIU-PS-GLD", unit_price: 1990, quantity: 1 }],
} as never;
const ITEMS = [{ line_item_id: "item_1", title: "Petal Studs", sku: "SIU-PS-GLD", quantity: 1 }] as never;

const LOGIN = { "POST /auth/login": [{ status: 200, body: { token: "tok" } }] };
const CREATED = { "POST /orders/create/adhoc": [{ status: 200, body: { order_id: 9001, shipment_id: 7001 } }] };
const AWB_OK = {
  "POST /courier/assign/awb": [
    { status: 200, body: { awb_assign_status: 1, response: { data: { awb_code: "SR123", courier_name: "Delhivery" } } } },
  ],
};
const PICKUP_OK = { "POST /courier/generate/pickup": [{ status: 200, body: {} }] };

const provider = (impl: typeof fetch, pg: ReturnType<typeof fakePg>) =>
  new ShiprocketFulfillmentProviderService({ __pg_connection__: pg as never }, { fetch: impl });

test("booking takes a courier order, an AWB and a pickup, and moves the order to processing", async () => {
  const pg = fakePg();
  const { impl, calls } = scripted({ ...LOGIN, ...CREATED, ...AWB_OK, ...PICKUP_OK });
  const result = await provider(impl, pg).createFulfillment({}, ITEMS, ORDER, {});
  assert.equal(result.labels[0]!.tracking_number, "SR123");
  assert.match(result.labels[0]!.tracking_url, /SR123$/);
  assert.equal(result.data.courier, "Delhivery");
  assert.deepEqual(calls, [
    "POST /auth/login",
    "POST /orders/create/adhoc",
    "POST /courier/assign/awb",
    "POST /courier/generate/pickup",
  ]);
  assert.equal(pg.shipments.get("order_1")!.awb, "SR123");
  assert.equal(pg.statuses.get("order_1"), "processing");
});

test("an AWB failure keeps the courier order, and the retry resumes from the AWB — no second booking", async () => {
  const pg = fakePg();
  const failing = scripted({
    ...LOGIN,
    ...CREATED,
    "POST /courier/assign/awb": [{ status: 200, body: { awb_assign_status: 0 } }],
  });
  await assert.rejects(provider(failing.impl, pg).createFulfillment({}, ITEMS, ORDER, {}), /No courier took SIU-00042/);
  assert.equal(pg.shipments.get("order_1")!.shipment_id, "7001");

  const retry = scripted({ ...LOGIN, ...AWB_OK, ...PICKUP_OK });
  const result = await provider(retry.impl, pg).createFulfillment({}, ITEMS, ORDER, {});
  assert.equal(result.labels[0]!.tracking_number, "SR123");
  assert.equal(retry.calls.includes("POST /orders/create/adhoc"), false, "the courier order is not created twice");
});

test("an order already booked is returned as booked, without calling the courier", async () => {
  const pg = fakePg();
  pg.shipments.set("order_1", { order_id: "order_1", courier_order_id: "9001", shipment_id: "7001", awb: "SR123", courier: "Delhivery" });
  const { impl, calls } = scripted({});
  const result = await provider(impl, pg).createFulfillment({}, ITEMS, ORDER, {});
  assert.equal(result.labels[0]!.tracking_number, "SR123");
  assert.deepEqual(calls, []);
});

test("without Shiprocket connected, the fulfilment goes through and says no courier was booked", async () => {
  const saved = { email: process.env.SHIPROCKET_EMAIL };
  delete process.env.SHIPROCKET_EMAIL;
  try {
    const { impl, calls } = scripted({});
    const result = await provider(impl, fakePg()).createFulfillment({}, ITEMS, ORDER, {});
    assert.equal(result.data.courier, "none");
    assert.deepEqual(result.labels, []);
    assert.deepEqual(calls, []);
  } finally {
    process.env.SHIPROCKET_EMAIL = saved.email;
  }
});

test("a refused booking is a message the operator can act on", async () => {
  const { impl } = scripted({ ...LOGIN, "POST /orders/create/adhoc": [{ status: 422, body: { message: "bad pincode" } }] });
  await assert.rejects(provider(impl, fakePg()).createFulfillment({}, ITEMS, ORDER, {}), /Shiprocket refused the booking for SIU-00042/);
});

test("Prepaid vs COD follows the payment Medusa recorded, not the order's metadata", async () => {
  // A Razorpay payment on the order: Prepaid — the courier collects nothing.
  const paid = fakePg();
  paid.payments.push({ id: "pay_1", provider_id: "pp_razorpay_razorpay" });
  const prepaid = scripted({ ...LOGIN, ...CREATED, ...AWB_OK, ...PICKUP_OK });
  await provider(prepaid.impl, paid).createFulfillment({}, ITEMS, ORDER, {});
  assert.equal((prepaid.bodies["POST /orders/create/adhoc"] as { payment_method: string }).payment_method, "Prepaid");

  // Metadata says UPI (shopper-writable once), but the payment is the system
  // provider's: the courier must collect.
  const cod = fakePg();
  cod.payments.push({ id: "pay_2", provider_id: "pp_system_default" });
  const forged = scripted({ ...LOGIN, ...CREATED, ...AWB_OK, ...PICKUP_OK });
  await provider(forged.impl, cod).createFulfillment({}, ITEMS, ORDER, {});
  assert.equal((forged.bodies["POST /orders/create/adhoc"] as { payment_method: string }).payment_method, "COD");
});
