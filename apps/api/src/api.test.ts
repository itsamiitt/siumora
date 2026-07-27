import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createTestDatabase, type TestDatabase } from "@siumora/db";

import { seed } from "../../../packages/db/src/seed.ts";

import { buildApp, type App } from "./app.ts";
import { sign } from "./lib/webhooks.ts";

/**
 * API integration tests against a real Postgres.
 *
 * `server.inject` drives the real routing, parsing and error handling without
 * binding a port, so these exercise the same code path a live request takes.
 */
const url = process.env.DATABASE_URL;
const apiTest = url ? test : test.skip;

/** Its own database: suites run in parallel and would clobber each other. */
let testDb: TestDatabase | undefined;

const RAZORPAY_SECRET = "test_razorpay_secret";
const COURIER_SECRET = "test_courier_secret";

let app: App;

before(async () => {
  if (!url) return;
  testDb = await createTestDatabase("api");
  app = await buildApp({
    connectionString: testDb!.url,
    corsOrigins: ["http://localhost:3000"],
    razorpayWebhookSecret: RAZORPAY_SECRET,
    courierWebhookSecret: COURIER_SECRET,
  });
});

beforeEach(async () => {
  if (!url) return;
  await app.pool.query(
    "DELETE FROM ndr_events; DELETE FROM return_requests; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM cart_lines; DELETE FROM carts; DELETE FROM idempotency_keys;",
  );
  await seed(testDb!.url);
});

after(async () => {
  if (!app) return;
  await app.server.close();
  await app.pool.end();
});

const json = (response: { body: string }) => JSON.parse(response.body);

async function newCartWith(sku: string, quantity = 1) {
  const cart = json(await app.server.inject({ method: "POST", url: "/carts" }));
  const products = json(await app.server.inject({ method: "GET", url: "/products" }));

  const variant = products.products
    .flatMap((p: { variants: Array<{ id: string; sku: string }> }) => p.variants)
    .find((v: { sku: string }) => v.sku === sku);

  await app.server.inject({
    method: "POST",
    url: `/carts/${cart.cartId}/lines`,
    payload: { variantId: variant.id, quantity },
  });

  return { cartId: cart.cartId as string, variantId: variant.id as string };
}

const ADDRESS = {
  name: "Asha Menon",
  phone: "9876543210",
  line1: "Flat 3B, Sunrise Apartments, Linking Road",
  city: "Mumbai",
  stateCode: "27",
  pincode: "400001",
};

apiTest("health check proves the database is reachable", async () => {
  const response = await app.server.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.equal(json(response).ok, true);
});

apiTest("serves the catalogue and a single product with its reviews", async () => {
  const list = json(await app.server.inject({ method: "GET", url: "/products" }));
  assert.equal(list.products.length, 4);

  const one = json(
    await app.server.inject({ method: "GET", url: "/products/petal-studs" }),
  );
  assert.equal(one.product.handle, "petal-studs");
  assert.equal(one.reviews.length, 2);
  assert.equal(one.rating.average, 4.5);
});

apiTest("search matches Hinglish through the API", async () => {
  const found = json(
    await app.server.inject({ method: "GET", url: "/products?q=jhumka" }),
  );
  assert.ok(
    found.products.some((p: { handle: string }) => p.handle === "petal-studs"),
  );
});

apiTest("rejects a malformed pincode rather than querying with it", async () => {
  const response = await app.server.inject({
    method: "GET",
    url: "/pincodes/12",
  });
  assert.equal(response.statusCode, 500);
});

apiTest("reports an unknown pincode as not serviceable", async () => {
  const body = json(
    await app.server.inject({ method: "GET", url: "/pincodes/999999" }),
  );
  assert.equal(body.serviceable, false);
  assert.equal(body.codAvailable, false);
});

apiTest("refuses to add more than the stock on hand", async () => {
  const products = json(await app.server.inject({ method: "GET", url: "/products" }));
  const soldOut = products.products
    .flatMap((p: { variants: Array<{ id: string; sku: string }> }) => p.variants)
    .find((v: { sku: string }) => v.sku === "SIU-JH-SLV");

  const cart = json(await app.server.inject({ method: "POST", url: "/carts" }));
  const response = await app.server.inject({
    method: "POST",
    url: `/carts/${cart.cartId}/lines`,
    payload: { variantId: soldOut.id, quantity: 1 },
  });

  // 409, not 400: the request was fine, the stock moved.
  assert.equal(response.statusCode, 409);
});

apiTest("places an order and issues an invoice", async () => {
  const { cartId } = await newCartWith("SIU-PS-GLD");

  const response = await app.server.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      cartId,
      address: ADDRESS,
      paymentMethod: "upi",
      eventId: crypto.randomUUID(),
    },
  });

  assert.equal(response.statusCode, 200);
  const body = json(response);
  assert.match(body.orderNumber, /^SIU-\d{5}$/);
});

apiTest("does not create a second order when a checkout is retried", async () => {
  const { cartId } = await newCartWith("SIU-PS-GLD");
  const key = crypto.randomUUID();
  const payload = {
    cartId,
    address: ADDRESS,
    paymentMethod: "upi",
    eventId: crypto.randomUUID(),
  };

  const first = await app.server.inject({
    method: "POST",
    url: "/checkout",
    headers: { "idempotency-key": key },
    payload,
  });
  const second = await app.server.inject({
    method: "POST",
    url: "/checkout",
    headers: { "idempotency-key": key },
    payload,
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  // The retry returns the first order rather than charging again.
  assert.equal(json(first).orderNumber, json(second).orderNumber);
  assert.equal(second.headers["idempotent-replay"], "true");

  const orders = await app.pool.query("SELECT count(*)::int AS n FROM orders");
  assert.equal(orders.rows[0].n, 1);
});

apiTest("refuses an idempotency key reused for a different request", async () => {
  const a = await newCartWith("SIU-PS-GLD");
  const b = await newCartWith("SIU-TB-12");
  const key = crypto.randomUUID();

  await app.server.inject({
    method: "POST",
    url: "/checkout",
    headers: { "idempotency-key": key },
    payload: { cartId: a.cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
  });

  const reused = await app.server.inject({
    method: "POST",
    url: "/checkout",
    headers: { "idempotency-key": key },
    payload: { cartId: b.cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
  });

  // Returning the first response here would hand one customer another's order.
  assert.equal(reused.statusCode, 422);
});

apiTest("derives the COD fee server-side rather than trusting the client", async () => {
  const { cartId } = await newCartWith("SIU-PS-GLD");

  const response = await app.server.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      cartId,
      address: ADDRESS,
      paymentMethod: "cod",
      eventId: crypto.randomUUID(),
      // A forged fee of zero must be ignored.
      codFee: 0,
    },
  });

  assert.equal(response.statusCode, 200);
  const order = await app.pool.query(
    "SELECT cod_fee FROM orders WHERE number = $1",
    [json(response).orderNumber],
  );
  assert.equal(order.rows[0].cod_fee, 4900);
});

apiTest("withholds COD where the courier does not carry it", async () => {
  const { cartId } = await newCartWith("SIU-PS-GLD");

  const response = await app.server.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      cartId,
      // Guwahati is seeded as not COD-serviceable.
      address: { ...ADDRESS, pincode: "781001", stateCode: "18", city: "Guwahati" },
      paymentMethod: "cod",
      eventId: crypto.randomUUID(),
    },
  });

  assert.equal(response.statusCode, 409);
  assert.match(json(response).message, /pincode/i);
});

apiTest("rejects an unsigned payment webhook", async () => {
  const response = await app.server.inject({
    method: "POST",
    url: "/webhooks/razorpay",
    payload: { event: "payment.captured", payload: {} },
  });

  // Without this, anyone who learns the URL can mark any order paid.
  assert.equal(response.statusCode, 401);
});

apiTest("rejects a payment webhook signed with the wrong secret", async () => {
  const body = JSON.stringify({ event: "payment.captured", payload: {} });
  const response = await app.server.inject({
    method: "POST",
    url: "/webhooks/razorpay",
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": sign(body, "not_the_secret"),
    },
    payload: body,
  });

  assert.equal(response.statusCode, 401);
});

apiTest("confirms an order on a correctly signed payment webhook", async () => {
  const { cartId } = await newCartWith("SIU-PS-GLD");
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
    }),
  );

  const body = JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: { entity: { id: "pay_1", notes: { order_number: placed.orderNumber } } },
    },
  });

  const response = await app.server.inject({
    method: "POST",
    url: "/webhooks/razorpay",
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": sign(body, RAZORPAY_SECRET),
    },
    payload: body,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(json(response).status, "confirmed");

  const order = await app.pool.query(
    "SELECT invoice_number FROM orders WHERE number = $1",
    [placed.orderNumber],
  );
  assert.match(order.rows[0].invoice_number, /^SIU\/\d{4}-\d{2}\/\d{6}$/);
});

apiTest("a replayed payment webhook does not issue a second invoice", async () => {
  const { cartId } = await newCartWith("SIU-PS-GLD");
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
    }),
  );

  const body = JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: { entity: { id: "pay_1", notes: { order_number: placed.orderNumber } } },
    },
  });
  const headers = {
    "content-type": "application/json",
    "x-razorpay-signature": sign(body, RAZORPAY_SECRET),
  };

  await app.server.inject({ method: "POST", url: "/webhooks/razorpay", headers, payload: body });
  const replay = await app.server.inject({
    method: "POST",
    url: "/webhooks/razorpay",
    headers,
    payload: body,
  });

  // Providers retry for days. A second invoice number would break the series.
  assert.equal(replay.statusCode, 200);
  assert.equal(json(replay).replayed, true);

  const invoices = await app.pool.query(
    "SELECT count(DISTINCT invoice_number)::int AS n FROM orders WHERE number = $1",
    [placed.orderNumber],
  );
  assert.equal(invoices.rows[0].n, 1);
});

apiTest("refuses an illegal order transition", async () => {
  const { cartId } = await newCartWith("SIU-PS-GLD");
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
    }),
  );

  const response = await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/status`,
    payload: { status: "delivered" },
  });

  // An unpaid order cannot be delivered, whatever the caller asks for.
  assert.equal(response.statusCode, 409);
});

apiTest("returns the parcel to origin once attempts are exhausted", async () => {
  const { cartId } = await newCartWith("SIU-PS-GLD");
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
    }),
  );

  const move = (status: string, ndrReason?: string) =>
    app.server.inject({
      method: "POST",
      url: `/orders/${placed.orderNumber}/status`,
      payload: { status, ndrReason },
    });

  for (const status of ["confirmed", "processing", "shipped", "out_for_delivery"]) {
    await move(status);
  }

  await move("ndr", "customer_unavailable");
  await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/ndr`,
    payload: { action: "reattempt" },
  });
  await move("ndr", "customer_unavailable");
  await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/ndr`,
    payload: { action: "reattempt" },
  });
  await move("ndr", "customer_unavailable");

  const order = await app.pool.query(
    "SELECT status, delivery_attempts FROM orders WHERE number = $1",
    [placed.orderNumber],
  );
  assert.equal(order.rows[0].status, "rto");
  assert.equal(order.rows[0].delivery_attempts, 3);
});

apiTest("refuses a return on pierced jewellery with a broken seal", async () => {
  const { cartId, variantId } = await newCartWith("SIU-PS-GLD");
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
    }),
  );

  for (const status of ["confirmed", "processing", "shipped", "out_for_delivery", "delivered"]) {
    await app.server.inject({
      method: "POST",
      url: `/orders/${placed.orderNumber}/status`,
      payload: { status },
    });
  }

  const refused = await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/returns`,
    payload: {
      variantIds: [variantId],
      reason: "changed_mind",
      resolution: "refund",
      sealIntact: false,
    },
  });
  assert.equal(refused.statusCode, 409);
  assert.match(json(refused).message, /hygiene/i);

  // The same item comes back regardless of the seal when it is faulty.
  const accepted = await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/returns`,
    payload: {
      variantIds: [variantId],
      reason: "damaged",
      resolution: "refund",
      sealIntact: false,
    },
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(json(accepted).return.freeReturnShipping, true);
});

apiTest("refuses a second open return on one order", async () => {
  const { cartId, variantId } = await newCartWith("SIU-PS-GLD");
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
    }),
  );
  for (const status of ["confirmed", "processing", "shipped", "out_for_delivery", "delivered"]) {
    await app.server.inject({
      method: "POST",
      url: `/orders/${placed.orderNumber}/status`,
      payload: { status },
    });
  }

  const body = {
    variantIds: [variantId],
    reason: "damaged",
    resolution: "refund",
  };
  await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/returns`,
    payload: body,
  });
  const second = await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/returns`,
    payload: body,
  });

  // A second refund on the same piece is money out the door twice.
  assert.equal(second.statusCode, 409);
});

apiTest("admin metrics keep transit value out of recognised revenue", async () => {
  const { cartId } = await newCartWith("SIU-PS-GLD");
  await app.server.inject({
    method: "POST",
    url: "/checkout",
    payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
  });

  const metrics = json(
    await app.server.inject({ method: "GET", url: "/admin/metrics" }),
  );

  assert.equal(metrics.revenue.recognised, 0);
  assert.ok(metrics.revenue.inFlight > 0);
  // The route is honest about being unprotected.
  assert.equal(metrics.unauthenticated, true);
});

apiTest("does not echo an origin that is not allow-listed", async () => {
  const allowed = await app.server.inject({
    method: "GET",
    url: "/health",
    headers: { origin: "http://localhost:3000" },
  });
  const denied = await app.server.inject({
    method: "GET",
    url: "/health",
    headers: { origin: "https://evil.example" },
  });

  assert.equal(allowed.headers["access-control-allow-origin"], "http://localhost:3000");
  assert.equal(denied.headers["access-control-allow-origin"], undefined);
});
