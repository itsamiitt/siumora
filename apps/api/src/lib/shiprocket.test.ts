import assert from "node:assert/strict";
import { test } from "node:test";

import { createShiprocketClient, type CreateShipmentInput } from "./shiprocket.ts";

function fakeFetch(
  script: Array<{ status: number; body: unknown }>,
): { fetch: typeof fetch; requests: Array<{ url: string; init: RequestInit }> } {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  let call = 0;
  const impl = (async (url: string | URL, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    const answer = script[Math.min(call, script.length - 1)]!;
    call += 1;
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      text: async () => JSON.stringify(answer.body),
    };
  }) as unknown as typeof fetch;
  return { fetch: impl, requests };
}

const SHIPMENT: CreateShipmentInput = {
  orderNumber: "SIU-00007",
  orderDate: "2026-07-29",
  pickupLocation: "Primary",
  address: {
    name: "Asha Menon",
    phone: "9876543210",
    line1: "Flat 3B, Sunrise Apartments",
    city: "Mumbai",
    stateName: "Maharashtra",
    pincode: "400001",
  },
  items: [{ name: "Petal Studs", sku: "SIU-PS-GLD", units: 1, sellingPrice: 1990, hsn: "7113" }],
  paymentMethod: "Prepaid",
  subTotal: 1990,
  weightKg: 0.3,
  dimensionsCm: { length: 12, breadth: 10, height: 4 },
};

const CREDS = { email: "ops@siumora.example", password: "hunter2" };

test("logs in once, then rides the bearer token", async () => {
  const { fetch, requests } = fakeFetch([
    { status: 200, body: { token: "tok_1" } },
    { status: 200, body: { order_id: 55, shipment_id: 77 } },
    { status: 200, body: { order_id: 56, shipment_id: 78 } },
  ]);
  const client = createShiprocketClient({ ...CREDS, fetch });

  const first = await client.createOrder(SHIPMENT);
  assert.deepEqual(first, { ok: true, orderId: "55", shipmentId: "77" });

  await client.createOrder(SHIPMENT);

  // One login, two authenticated calls.
  assert.equal(requests.length, 3);
  assert.match(requests[0]!.url, /\/auth\/login$/);
  const headers = requests[1]!.init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer tok_1");
  assert.match(requests[1]!.url, /\/orders\/create\/adhoc$/);

  const body = JSON.parse(String(requests[1]!.init.body));
  assert.equal(body.order_id, "SIU-00007");
  assert.equal(body.billing_state, "Maharashtra");
  assert.equal(body.payment_method, "Prepaid");
  // Rupees on the wire; the ledger keeps paise.
  assert.equal(body.order_items[0].selling_price, 1990);
  assert.equal(body.weight, 0.3);
});

test("an expired token refreshes exactly once, then the call retries", async () => {
  const { fetch, requests } = fakeFetch([
    { status: 200, body: { token: "tok_old" } },
    { status: 401, body: { message: "expired" } },
    { status: 200, body: { token: "tok_new" } },
    { status: 200, body: { order_id: 60, shipment_id: 80 } },
  ]);
  const client = createShiprocketClient({ ...CREDS, fetch });

  const result = await client.createOrder(SHIPMENT);
  assert.deepEqual(result, { ok: true, orderId: "60", shipmentId: "80" });

  // login, 401'd call, re-login, retried call — and no further loop.
  assert.equal(requests.length, 4);
  const retried = requests[3]!.init.headers as Record<string, string>;
  assert.equal(retried.authorization, "Bearer tok_new");
});

test("an AWB nobody assigned is an error the operator can act on", async () => {
  const { fetch } = fakeFetch([
    { status: 200, body: { token: "tok_1" } },
    { status: 200, body: { awb_assign_status: 0, response: {} } },
  ]);
  const client = createShiprocketClient({ ...CREDS, fetch });

  const result = await client.assignAwb("77");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /no courier/);
});

test("an assigned AWB carries the courier's name", async () => {
  const { fetch } = fakeFetch([
    { status: 200, body: { token: "tok_1" } },
    {
      status: 200,
      body: {
        awb_assign_status: 1,
        response: { data: { awb_code: "AWB9000", courier_name: "Bluedart" } },
      },
    },
  ]);
  const client = createShiprocketClient({ ...CREDS, fetch });

  assert.deepEqual(await client.assignAwb("77"), {
    ok: true,
    awb: "AWB9000",
    courier: "Bluedart",
  });
});

test("a return is created with the customer's address as the pickup", async () => {
  const { fetch, requests } = fakeFetch([
    { status: 200, body: { token: "tok_1" } },
    { status: 200, body: { order_id: 90, shipment_id: 91 } },
  ]);
  const client = createShiprocketClient({ ...CREDS, fetch });

  const result = await client.createReturn(SHIPMENT);
  assert.deepEqual(result, { ok: true, orderId: "90", shipmentId: "91" });

  const body = JSON.parse(String(requests[1]!.init.body));
  assert.match(requests[1]!.url, /\/orders\/create\/return$/);
  assert.equal(body.pickup_customer_name, "Asha Menon");
  assert.equal(body.pickup_pincode, "400001");
  assert.equal(body.pickup_state, "Maharashtra");
});
