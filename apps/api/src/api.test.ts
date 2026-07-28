import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createTestDatabase, type TestDatabase } from "@siumora/db";

import { seed } from "../../../packages/db/src/seed.ts";

import { buildApp, type App } from "./app.ts";
import { createRateLimiter } from "./lib/rate-limit.ts";
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
const OPERATOR_PHONE = "9000000001";

let app: App;

before(async () => {
  if (!url) return;
  testDb = await createTestDatabase("api");
  app = await buildApp({
    connectionString: testDb!.url,
    corsOrigins: ["http://localhost:3000"],
    razorpayWebhookSecret: RAZORPAY_SECRET,
    courierWebhookSecret: COURIER_SECRET,
    adminPhones: OPERATOR_PHONE,
    // No WhatsApp sender in a test run, so the code comes back in the response.
    otpEcho: true,
    // The courier-simulation transitions the delivered and NDR paths depend on.
    courierSimulation: true,
    // Every test in this file arrives from 127.0.0.1, so the shipped limits
    // would throttle the suite against itself after the second sign-in. The
    // limits are exercised deliberately below, on an app built for it.
    rateLimiter: createRateLimiter([]),
  });
});

beforeEach(async () => {
  if (!url) return;
  await app.pool.query(
    "DELETE FROM ndr_events; DELETE FROM return_requests; DELETE FROM cod_remittances; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM cart_lines; DELETE FROM carts; DELETE FROM idempotency_keys; DELETE FROM sessions; DELETE FROM otp_challenges; DELETE FROM customers;",
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

/** Walk the real two-step sign-in and hand back a bearer header. */
async function signIn(phone: string) {
  const issued = json(
    await app.server.inject({
      method: "POST",
      url: "/auth/otp",
      payload: { phone },
    }),
  );

  const verified = json(
    await app.server.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { phone, code: issued.code },
    }),
  );

  return {
    token: verified.token as string,
    headers: { authorization: `Bearer ${verified.token}` },
    body: verified,
  };
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
    url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
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
      url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
      payload: { status, ndrReason },
    });

  for (const status of ["confirmed", "processing", "shipped", "out_for_delivery"]) {
    await move(status);
  }

  await move("ndr", "customer_unavailable");
  await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/ndr?key=${placed.accessKey}`,
    payload: { action: "reattempt" },
  });
  await move("ndr", "customer_unavailable");
  await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/ndr?key=${placed.accessKey}`,
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
      url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
      payload: { status },
    });
  }

  const refused = await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/returns?key=${placed.accessKey}`,
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
    url: `/orders/${placed.orderNumber}/returns?key=${placed.accessKey}`,
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
      url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
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
    url: `/orders/${placed.orderNumber}/returns?key=${placed.accessKey}`,
    payload: body,
  });
  const second = await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/returns?key=${placed.accessKey}`,
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

  const operator = await signIn(OPERATOR_PHONE);
  const metrics = json(
    await app.server.inject({
      method: "GET",
      url: "/admin/metrics",
      headers: operator.headers,
    }),
  );

  assert.equal(metrics.revenue.recognised, 0);
  assert.ok(metrics.revenue.inFlight > 0);
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

// ── Sign-in ───────────────────────────────────────────────────

apiTest("signs in with a code and returns a usable session", async () => {
  const { headers, body } = await signIn("9812345678");

  assert.equal(body.ok, true);
  assert.equal(body.isAdmin, false);
  assert.equal(body.customer.maskedPhone, "98••••5678");

  const session = json(
    await app.server.inject({ method: "GET", url: "/auth/session", headers }),
  );
  assert.equal(session.signedIn, true);
  assert.equal(session.customer.phone, "9812345678");
});

apiTest("accepts a number however it is typed and keeps one customer", async () => {
  await signIn("9812345678");
  await signIn("+91 98123 45678");

  const rows = await app.pool.query(
    "SELECT count(*)::int AS n FROM customers WHERE phone = '9812345678'",
  );
  assert.equal(rows.rows[0].n, 1);
});

apiTest("refuses a wrong code and counts the attempt down", async () => {
  const phone = "9812345679";
  await app.server.inject({ method: "POST", url: "/auth/otp", payload: { phone } });

  const wrong = await app.server.inject({
    method: "POST",
    url: "/auth/verify",
    payload: { phone, code: "000000" },
  });

  assert.equal(wrong.statusCode, 401);
  assert.equal(json(wrong).attemptsRemaining, 4);
});

apiTest("locks a code after five wrong guesses", async () => {
  const phone = "9812345670";
  const issued = json(
    await app.server.inject({ method: "POST", url: "/auth/otp", payload: { phone } }),
  );

  // Deliberately never the real code, so the lock is what stops it.
  const wrong = issued.code === "000000" ? "111111" : "000000";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await app.server.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { phone, code: wrong },
    });
  }

  // Even the right code no longer works: otherwise the limit is decorative.
  const correct = await app.server.inject({
    method: "POST",
    url: "/auth/verify",
    payload: { phone, code: issued.code },
  });
  assert.equal(correct.statusCode, 410);
});

apiTest("will not let one code sign in twice", async () => {
  const phone = "9812345671";
  const issued = json(
    await app.server.inject({ method: "POST", url: "/auth/otp", payload: { phone } }),
  );

  const first = await app.server.inject({
    method: "POST",
    url: "/auth/verify",
    payload: { phone, code: issued.code },
  });
  const replay = await app.server.inject({
    method: "POST",
    url: "/auth/verify",
    payload: { phone, code: issued.code },
  });

  assert.equal(first.statusCode, 200);
  assert.equal(replay.statusCode, 410);
});

apiTest("throttles a second code to the same number", async () => {
  const phone = "9812345672";
  await app.server.inject({ method: "POST", url: "/auth/otp", payload: { phone } });
  const again = await app.server.inject({
    method: "POST",
    url: "/auth/otp",
    payload: { phone },
  });

  assert.equal(again.statusCode, 429);
  assert.ok(Number(again.headers["retry-after"]) > 0);
});

apiTest("rejects a number that is not an Indian mobile before spending a send", async () => {
  const response = await app.server.inject({
    method: "POST",
    url: "/auth/otp",
    payload: { phone: "1234567890" },
  });

  assert.equal(response.statusCode, 400);
  const rows = await app.pool.query("SELECT count(*)::int AS n FROM otp_challenges");
  assert.equal(rows.rows[0].n, 0);
});

apiTest("never stores the code in the clear", async () => {
  const phone = "9812345673";
  const issued = json(
    await app.server.inject({ method: "POST", url: "/auth/otp", payload: { phone } }),
  );

  const rows = await app.pool.query(
    "SELECT code_hash FROM otp_challenges WHERE phone = $1",
    [phone],
  );
  assert.ok(!rows.rows[0].code_hash.includes(issued.code));
});

apiTest("a signed-out session stops working", async () => {
  const { headers } = await signIn("9812345674");
  await app.server.inject({ method: "POST", url: "/auth/signout", headers });

  const session = json(
    await app.server.inject({ method: "GET", url: "/auth/session", headers }),
  );
  assert.equal(session.signedIn, false);
});

// ── Order ownership ───────────────────────────────────────────

apiTest("will not hand an order to someone holding only its number", async () => {
  const { cartId } = await newCartWith("SIU-PS-GLD");
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
    }),
  );

  const guessed = await app.server.inject({
    method: "GET",
    url: `/orders/${placed.orderNumber}`,
  });
  // 404, not 403: a 403 confirms the number is real, which is the whole point
  // of walking SIU-00001 upward.
  assert.equal(guessed.statusCode, 404);

  const withKey = await app.server.inject({
    method: "GET",
    url: `/orders/${placed.orderNumber}?key=${placed.accessKey}`,
  });
  assert.equal(withKey.statusCode, 200);
});

apiTest("attaches an order to the customer who was signed in", async () => {
  const buyer = await signIn(ADDRESS.phone);
  const { cartId } = await newCartWith("SIU-PS-GLD");

  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      headers: buyer.headers,
      payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
    }),
  );

  const own = json(
    await app.server.inject({
      method: "GET",
      url: `/orders/${placed.orderNumber}`,
      headers: buyer.headers,
    }),
  );
  assert.equal(own.order.number, placed.orderNumber);
  assert.equal(own.order.phoneVerified, true);

  const mine = json(
    await app.server.inject({ method: "GET", url: "/orders", headers: buyer.headers }),
  );
  assert.equal(mine.orders.length, 1);
});

apiTest("keeps one customer's order out of another's hands", async () => {
  const buyer = await signIn(ADDRESS.phone);
  const stranger = await signIn("9812345675");
  const { cartId } = await newCartWith("SIU-PS-GLD");

  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      headers: buyer.headers,
      payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
    }),
  );

  const peek = await app.server.inject({
    method: "GET",
    url: `/orders/${placed.orderNumber}`,
    headers: stranger.headers,
  });
  assert.equal(peek.statusCode, 404);

  const theirs = json(
    await app.server.inject({ method: "GET", url: "/orders", headers: stranger.headers }),
  );
  assert.equal(theirs.orders.length, 0);
});

apiTest("claims a guest order when its number signs in later", async () => {
  const { cartId } = await newCartWith("SIU-PS-GLD");
  await app.server.inject({
    method: "POST",
    url: "/checkout",
    payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
  });

  const buyer = await signIn(ADDRESS.phone);
  assert.equal(buyer.body.claimedOrders, 1);

  const mine = json(
    await app.server.inject({ method: "GET", url: "/orders", headers: buyer.headers }),
  );
  assert.equal(mine.orders.length, 1);
});

apiTest("an operator can read any order", async () => {
  const { cartId } = await newCartWith("SIU-PS-GLD");
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
    }),
  );

  const operator = await signIn(OPERATOR_PHONE);
  const response = await app.server.inject({
    method: "GET",
    url: `/orders/${placed.orderNumber}`,
    headers: operator.headers,
  });
  assert.equal(response.statusCode, 200);
});

// ── Operator access ───────────────────────────────────────────

apiTest("refuses the ops dashboard to an anonymous caller", async () => {
  const response = await app.server.inject({ method: "GET", url: "/admin/metrics" });
  assert.equal(response.statusCode, 401);
});

apiTest("refuses the ops dashboard to a customer who is not on the allow-list", async () => {
  const shopper = await signIn("9812345676");
  const response = await app.server.inject({
    method: "GET",
    url: "/admin/metrics",
    headers: shopper.headers,
  });
  assert.equal(response.statusCode, 403);
});

apiTest("gives a verified repeat buyer the trusted COD terms", async () => {
  // Three delivered orders is what COD_TRUSTED_ORDER_COUNT asks for, and it
  // was unreachable while every checkout was anonymous.
  const buyer = await signIn(ADDRESS.phone);
  const operator = await signIn(OPERATOR_PHONE);

  for (let round = 0; round < 3; round += 1) {
    const { cartId } = await newCartWith("SIU-PS-SLV");
    const placed = json(
      await app.server.inject({
        method: "POST",
        url: "/checkout",
        headers: buyer.headers,
        payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
      }),
    );

    for (const status of [
      "confirmed",
      "processing",
      "shipped",
      "out_for_delivery",
      "delivered",
    ]) {
      await app.server.inject({
        method: "POST",
        url: `/orders/${placed.orderNumber}/status`,
        headers: operator.headers,
        payload: { status },
      });
    }
  }

  const { cartId } = await newCartWith("SIU-PS-SLV");
  const quote = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout/quote",
      headers: buyer.headers,
      payload: { cartId, pincode: ADDRESS.pincode, phone: ADDRESS.phone },
    }),
  );

  assert.equal(quote.phoneVerified, true);
  assert.equal(quote.cod.available, true);
  assert.equal(quote.cod.fee, 0);
});

// ── Invoicing and the courier webhook ─────────────────────────

apiTest("issues an invoice however an order reaches confirmed", async () => {
  // Three paths reach `confirmed` and each used to allocate its own number.
  // An order that ends up delivered with no invoice number is a compliance
  // problem for a GST-registered seller, so every path is checked.
  const operator = await signIn(OPERATOR_PHONE);

  const place = async () => {
    const { cartId } = await newCartWith("SIU-PS-SLV");
    return json(
      await app.server.inject({
        method: "POST",
        url: "/checkout",
        payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
      }),
    );
  };

  // 1. The courier-simulation transition.
  const viaStatus = await place();
  await app.server.inject({
    method: "POST",
    url: `/orders/${viaStatus.orderNumber}/status?key=${viaStatus.accessKey}`,
    payload: { status: "confirmed" },
  });

  // 2. The explicit confirmation.
  const viaConfirm = await place();
  await app.server.inject({
    method: "POST",
    url: `/orders/${viaConfirm.orderNumber}/confirm?key=${viaConfirm.accessKey}`,
  });

  // 3. The signed payment webhook.
  const viaWebhook = await place();
  const payload = JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: { id: "pay_1", notes: { order_number: viaWebhook.orderNumber } },
      },
    },
  });
  await app.server.inject({
    method: "POST",
    url: "/webhooks/razorpay",
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": sign(payload, RAZORPAY_SECRET),
    },
    payload,
  });

  const { rows } = await app.pool.query(
    "SELECT number, invoice_number FROM orders WHERE number = ANY($1::text[]) ORDER BY number",
    [[viaStatus.orderNumber, viaConfirm.orderNumber, viaWebhook.orderNumber]],
  );

  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.match(row.invoice_number ?? "", /^SIU\/\d{4}-\d{2}\/\d{6}$/, row.number);
  }

  // And the series stays unique within the year.
  const distinct = new Set(rows.map((row: { invoice_number: string }) => row.invoice_number));
  assert.equal(distinct.size, 3);

  // The operator dashboard should see all three.
  const metrics = json(
    await app.server.inject({
      method: "GET",
      url: "/admin/metrics",
      headers: operator.headers,
    }),
  );
  assert.equal(metrics.invoiceSeries.issued, 3);
});

apiTest("lets a signed courier webhook move an order it has no session for", async () => {
  // The webhook carries a signature, not a session or an order access key.
  // Routing it through the authorised HTTP route would refuse every callback.
  const { cartId } = await newCartWith("SIU-PS-GLD");
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
    }),
  );

  await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
    payload: { status: "confirmed" },
  });

  // Processing is the legal next step from confirmed; the webhook applies the
  // same state machine the HTTP route does.
  const body = JSON.stringify({
    order_number: placed.orderNumber,
    status: "processing",
  });
  const response = await app.server.inject({
    method: "POST",
    url: "/webhooks/courier",
    headers: {
      "content-type": "application/json",
      "x-courier-signature": sign(body, COURIER_SECRET),
    },
    payload: body,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(json(response).ok, true);

  const { rows } = await app.pool.query(
    "SELECT status FROM orders WHERE number = $1",
    [placed.orderNumber],
  );
  assert.equal(rows[0].status, "processing");
});

// ── Stock coming back ─────────────────────────────────────────

/** Stock on hand for a SKU, read straight from the table. */
async function stockOf(sku: string): Promise<number> {
  const { rows } = await app.pool.query(
    "SELECT inventory FROM variants WHERE sku = $1",
    [sku],
  );
  return rows[0].inventory;
}

apiTest("puts stock back at once when an order is cancelled before dispatch", async () => {
  const before = await stockOf("SIU-PS-GLD");
  const { cartId } = await newCartWith("SIU-PS-GLD");
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
    }),
  );

  assert.equal(await stockOf("SIU-PS-GLD"), before - 1, "stock leaves at placement");

  await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
    payload: { status: "cancelled" },
  });

  // The goods never left the building, so there is nothing to wait for.
  assert.equal(await stockOf("SIU-PS-GLD"), before);
});

apiTest("holds stock back until a returning parcel is actually received", async () => {
  const before = await stockOf("SIU-PS-GLD");
  const operator = await signIn(OPERATOR_PHONE);
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
      url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
      payload: { status, ndrReason },
    });

  for (const status of ["confirmed", "processing", "shipped"]) await move(status);
  await move("rto");

  // On a van, not on a shelf. Counting it now promises a piece days away.
  assert.equal(await stockOf("SIU-PS-GLD"), before - 1);

  const restocked = await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/restock`,
    headers: operator.headers,
  });
  assert.equal(restocked.statusCode, 200);
  assert.equal(json(restocked).units, 1);
  assert.equal(await stockOf("SIU-PS-GLD"), before);
});

apiTest("will not put the same goods back twice", async () => {
  const before = await stockOf("SIU-PS-GLD");
  const operator = await signIn(OPERATOR_PHONE);
  const { cartId } = await newCartWith("SIU-PS-GLD");
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
    }),
  );

  for (const status of ["confirmed", "processing", "shipped", "rto"]) {
    await app.server.inject({
      method: "POST",
      url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
      payload: { status },
    });
  }

  const restock = () =>
    app.server.inject({
      method: "POST",
      url: `/orders/${placed.orderNumber}/restock`,
      headers: operator.headers,
    });

  await restock();
  const second = await restock();

  // A repeat click is somebody checking, not an error — but it must not add
  // a second unit that does not exist.
  assert.equal(json(second).ok, false);
  assert.equal(json(second).reason, "already_restocked");
  assert.equal(await stockOf("SIU-PS-GLD"), before);
});

apiTest("refuses to restock an order that is still live", async () => {
  const operator = await signIn(OPERATOR_PHONE);
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
    url: `/orders/${placed.orderNumber}/restock`,
    headers: operator.headers,
  });

  // Those goods are in a box with someone's name on it.
  assert.equal(response.statusCode, 409);
  assert.equal(json(response).reason, "not_eligible");
});

apiTest("lists what is still owed back, and drops it once returned", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  const { cartId } = await newCartWith("SIU-PS-SLV");
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
    }),
  );

  for (const status of ["confirmed", "processing", "shipped", "rto"]) {
    await app.server.inject({
      method: "POST",
      url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
      payload: { status },
    });
  }

  const queue = () =>
    app.server
      .inject({ method: "GET", url: "/admin/restock-queue", headers: operator.headers })
      .then((r) => json(r).orders.map((o: { number: string }) => o.number));

  assert.deepEqual(await queue(), [placed.orderNumber]);

  await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/restock`,
    headers: operator.headers,
  });

  assert.deepEqual(await queue(), []);
});

apiTest("keeps the restock queue away from a customer", async () => {
  const shopper = await signIn("9812340001");
  const response = await app.server.inject({
    method: "GET",
    url: "/admin/restock-queue",
    headers: shopper.headers,
  });
  assert.equal(response.statusCode, 403);
});

// ── Conversions ───────────────────────────────────────────────

/** The ledger rows for an order, by event name and destination. */
async function ledgerFor(orderNumber: string) {
  const { rows } = await app.pool.query(
    `SELECT t.event_name, t.destination, t.status
     FROM tracking_events t
     JOIN orders o ON o.event_id = t.event_id
     WHERE o.number = $1
     ORDER BY t.event_name, t.destination`,
    [orderNumber],
  );
  return rows.map((r) => `${r.event_name}/${r.destination}/${r.status}`);
}

async function placeAndMove(payment: string, sku: string, statuses: string[]) {
  const { cartId } = await newCartWith(sku);
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      payload: {
        cartId,
        address: ADDRESS,
        paymentMethod: payment,
        eventId: crypto.randomUUID(),
      },
    }),
  );

  for (const status of statuses) {
    await app.server.inject({
      method: "POST",
      url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
      payload: { status },
    });
  }
  return placed;
}

apiTest("counts a prepaid order at confirmation", async () => {
  const placed = await placeAndMove("upi", "SIU-PS-GLD", ["confirmed"]);
  assert.deepEqual(await ledgerFor(placed.orderNumber), [
    "purchase/ga4/skipped",
    "purchase/meta/skipped",
  ]);
});

apiTest("does not count a COD order until it is actually delivered", async () => {
  // Roughly a fifth of COD orders come back. A purchase fired at checkout
  // inflates revenue and teaches the ad platforms to buy the traffic that
  // returns most.
  const placed = await placeAndMove("cod", "SIU-TB-12", ["confirmed", "processing", "shipped"]);
  assert.deepEqual(await ledgerFor(placed.orderNumber), []);

  await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
    payload: { status: "out_for_delivery" },
  });
  await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
    payload: { status: "delivered" },
  });

  assert.deepEqual(await ledgerFor(placed.orderNumber), [
    "cod_delivered/ga4/skipped",
    "cod_delivered/meta/skipped",
  ]);
});

apiTest("a prepaid order that is returned keeps its purchase, and only one", async () => {
  const placed = await placeAndMove("upi", "SIU-PS-GLD", [
    "confirmed",
    "processing",
    "shipped",
    "out_for_delivery",
    "delivered",
  ]);

  // `delivered` is not a second conversion for a prepaid order — it already
  // converted at confirmation.
  assert.deepEqual(await ledgerFor(placed.orderNumber), [
    "purchase/ga4/skipped",
    "purchase/meta/skipped",
  ]);
});

apiTest("a replayed payment webhook does not count the sale twice", async () => {
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
      payment: { entity: { id: "pay_dup", notes: { order_number: placed.orderNumber } } },
    },
  });
  const deliver = () =>
    app.server.inject({
      method: "POST",
      url: "/webhooks/razorpay",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": sign(body, RAZORPAY_SECRET),
      },
      payload: body,
    });

  await deliver();
  await deliver();

  // Providers retry for days. The ledger's unique index on
  // (event_id, destination) is what makes that safe.
  assert.deepEqual(await ledgerFor(placed.orderNumber), [
    "purchase/ga4/skipped",
    "purchase/meta/skipped",
  ]);
});

apiTest("the payment webhook reports revenue at all", async () => {
  // It bypasses the courier route entirely, so queueing conversions per-caller
  // was how it ended up silently reporting nothing.
  const { cartId } = await newCartWith("SIU-PS-SLV");
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
      payment: { entity: { id: "pay_x", notes: { order_number: placed.orderNumber } } },
    },
  });
  await app.server.inject({
    method: "POST",
    url: "/webhooks/razorpay",
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": sign(body, RAZORPAY_SECRET),
    },
    payload: body,
  });

  assert.ok((await ledgerFor(placed.orderNumber)).length > 0);
});

apiTest("carries the order's own event id, so the pixel and the server agree", async () => {
  const eventId = crypto.randomUUID();
  const { cartId } = await newCartWith("SIU-PS-GLD");
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId },
    }),
  );
  await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
    payload: { status: "confirmed" },
  });

  const { rows } = await app.pool.query(
    "SELECT event_id, payload FROM tracking_events WHERE destination = 'meta' AND event_id = $1",
    [eventId],
  );
  assert.equal(rows.length, 1);
  // The dedup key has to survive into the payload, or the two sends land as
  // two conversions.
  assert.equal(rows[0].payload.event_id, eventId);
  assert.equal(rows[0].payload.event_name, "Purchase");
});

apiTest("reports orders that produced no conversion at all", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  await placeAndMove("upi", "SIU-PS-GLD", ["confirmed"]);

  // An order confirmed with the ledger emptied behind it is exactly the parity
  // gap doc 08 §8 asks to be watched.
  await app.pool.query("DELETE FROM tracking_events");

  const metrics = json(
    await app.server.inject({
      method: "GET",
      url: "/admin/metrics",
      headers: operator.headers,
    }),
  );
  assert.equal(metrics.tracking.missingConversions.length, 1);
  assert.equal(metrics.tracking.health.sent, 0);
});

// ── GST desk ──────────────────────────────────────────────────

const B2B_GSTIN = "27AAPFU0939F1ZV";

async function confirmedOrder(overrides: Record<string, unknown> = {}) {
  const { cartId } = await newCartWith("SIU-PS-GLD");
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      payload: {
        cartId,
        address: ADDRESS,
        paymentMethod: "upi",
        eventId: crypto.randomUUID(),
        ...overrides,
      },
    }),
  );

  if (placed.orderNumber) {
    await app.server.inject({
      method: "POST",
      url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
      payload: { status: "confirmed" },
    });
  }
  return placed;
}

/** The period the seeded orders land in, read the way the code reads it. */
function thisPeriod(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

apiTest("refuses a GSTIN whose check digit is wrong", async () => {
  const { cartId } = await newCartWith("SIU-PS-GLD");
  const response = await app.server.inject({
    method: "POST",
    url: "/checkout",
    payload: {
      cartId,
      address: ADDRESS,
      paymentMethod: "upi",
      eventId: crypto.randomUUID(),
      // Right shape, wrong last character. On an invoice this denies the buyer
      // their input credit and lands in the seller's mismatch report.
      buyerGstin: "27AAPFU0939F1ZW",
    },
  });

  assert.equal(response.statusCode, 500);
  const stored = await app.pool.query("SELECT count(*)::int AS n FROM orders");
  assert.equal(stored.rows[0].n, 0);
});

apiTest("stores a valid GSTIN, normalised", async () => {
  await confirmedOrder({ buyerGstin: " 27aapfu0939f1zv " });
  const { rows } = await app.pool.query("SELECT buyer_gstin FROM orders");
  // Case and stray spaces are not the customer's problem, but the stored value
  // has to be the canonical one or the return will not match the portal.
  assert.equal(rows[0].buyer_gstin, B2B_GSTIN);
});

apiTest("files a registered buyer invoice-wise and a consumer as a summary", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  await confirmedOrder({ buyerGstin: B2B_GSTIN });
  await confirmedOrder();

  const gstr1 = json(
    await app.server.inject({
      method: "GET",
      url: `/admin/gstr1?period=${thisPeriod()}`,
      headers: operator.headers,
    }),
  );

  assert.equal(gstr1.b2b.length, 1);
  assert.equal(gstr1.b2b[0].gstin, B2B_GSTIN);
  assert.equal(gstr1.b2cs.length, 1);
  assert.equal(gstr1.totals.invoices, 2);
});

apiTest("the HSN table reconciles to the invoice tables", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  await confirmedOrder({ buyerGstin: B2B_GSTIN });
  await confirmedOrder();

  const gstr1 = json(
    await app.server.inject({
      method: "GET",
      url: `/admin/gstr1?period=${thisPeriod()}`,
      headers: operator.headers,
    }),
  );

  // The cross-check a return is scrutinised on: if these two disagree the
  // filing is wrong whichever one is right.
  const hsnTaxable = gstr1.hsn.reduce(
    (sum: number, row: { taxableValue: number }) => sum + row.taxableValue,
    0,
  );
  assert.equal(hsnTaxable, gstr1.totals.taxableValue);
});

apiTest("leaves uninvoiced orders out of the return", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  // Placed but never confirmed, so no invoice number was ever allocated.
  const { cartId } = await newCartWith("SIU-PS-GLD");
  await app.server.inject({
    method: "POST",
    url: "/checkout",
    payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
  });

  const gstr1 = json(
    await app.server.inject({
      method: "GET",
      url: `/admin/gstr1?period=${thisPeriod()}`,
      headers: operator.headers,
    }),
  );
  assert.equal(gstr1.totals.invoices, 0);
});

apiTest("exports the return as CSV with every table", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  await confirmedOrder({ buyerGstin: B2B_GSTIN });

  const response = await app.server.inject({
    method: "GET",
    url: `/admin/gstr1?period=${thisPeriod()}&format=csv`,
    headers: operator.headers,
  });

  assert.match(response.headers["content-type"] as string, /text\/csv/);
  assert.match(
    response.headers["content-disposition"] as string,
    /attachment; filename="gstr1-\d{4}-\d{2}\.csv"/,
  );
  for (const table of ["B2B", "B2CL", "B2CS", "HSN"]) {
    assert.ok(response.body.includes(`\n${table}\n`), table);
  }
  assert.ok(response.body.includes(B2B_GSTIN));
});

apiTest("refuses a malformed period rather than guessing one", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  const response = await app.server.inject({
    method: "GET",
    url: "/admin/gstr1?period=2026-13",
    headers: operator.headers,
  });
  assert.equal(response.statusCode, 500);
});

apiTest("keeps the return away from a customer", async () => {
  const shopper = await signIn("9812340002");
  const response = await app.server.inject({
    method: "GET",
    url: `/admin/gstr1?period=${thisPeriod()}`,
    headers: shopper.headers,
  });
  assert.equal(response.statusCode, 403);
});

// ── COD remittance desk ───────────────────────────────────────

/** A delivered COD order, plus the amount the courier should have collected. */
async function deliveredCod(sku = "SIU-TB-12") {
  const placed = await placeAndMove("cod", sku, [
    "confirmed",
    "processing",
    "shipped",
    "out_for_delivery",
    "delivered",
  ]);
  const { rows } = await app.pool.query(
    "SELECT total, status FROM orders WHERE number = $1",
    [placed.orderNumber],
  );
  assert.equal(rows[0].status, "delivered", "the COD order reached delivery");
  return { number: placed.orderNumber as string, total: rows[0].total as number };
}

function batch(
  rows: Array<Record<string, unknown>>,
  overrides: Record<string, unknown> = {},
) {
  return {
    batchId: "BLUEDART-2026-07-28",
    courier: "Bluedart",
    rows,
    ...overrides,
  };
}

apiTest("passes a remittance line that collected the invoice", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  const order = await deliveredCod();

  const result = json(
    await app.server.inject({
      method: "POST",
      url: "/admin/remittances",
      headers: operator.headers,
      payload: batch([
        {
          orderNumber: order.number,
          collected: order.total,
          // The courier keeps freight and its COD charge. That gap is not a
          // shortfall, and treating it as one flags every line in the file.
          deductions: 6500,
          remitted: order.total - 6500,
        },
      ]),
    }),
  );

  assert.equal(result.counts.matched, 1);
  assert.equal(result.shortfall, 0);
  assert.equal(result.exceptions.length, 0);
  assert.equal(result.deductions, 6500);
  assert.equal(result.recorded, 1);
});

apiTest("names the money a short collection left behind", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  const order = await deliveredCod();

  const result = json(
    await app.server.inject({
      method: "POST",
      url: "/admin/remittances",
      headers: operator.headers,
      payload: batch([
        {
          orderNumber: order.number,
          collected: order.total - 4900,
          deductions: 6500,
          remitted: order.total - 4900 - 6500,
        },
      ]),
    }),
  );

  assert.equal(result.shortfall, 4900);
  assert.equal(result.exceptions[0].outcome, "short");
  assert.equal(result.exceptions[0].variance, -4900);
});

apiTest("re-uploading a file books nothing twice", async () => {
  // Couriers resend files routinely. Without the batch key the same collection
  // is credited again and the cash position drifts upward with nobody noticing.
  const operator = await signIn(OPERATOR_PHONE);
  const order = await deliveredCod();
  const payload = batch([
    {
      orderNumber: order.number,
      collected: order.total,
      deductions: 6500,
      remitted: order.total - 6500,
    },
  ]);

  const first = json(
    await app.server.inject({
      method: "POST",
      url: "/admin/remittances",
      headers: operator.headers,
      payload,
    }),
  );
  const second = json(
    await app.server.inject({
      method: "POST",
      url: "/admin/remittances",
      headers: operator.headers,
      payload,
    }),
  );

  assert.equal(first.recorded, 1);
  assert.equal(second.recorded, 0);
  assert.equal(second.replayed, true);
  // The replay reports what the original said, not a wall of duplicates.
  assert.equal(second.counts.matched, 1);

  const stored = await app.pool.query(
    "SELECT count(*)::int AS n FROM cod_remittances WHERE order_number = $1",
    [order.number],
  );
  assert.equal(stored.rows[0].n, 1);
});

apiTest("refuses to pay for the same order in a second batch", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  const order = await deliveredCod();
  const line = {
    orderNumber: order.number,
    collected: order.total,
    deductions: 6500,
    remitted: order.total - 6500,
  };

  await app.server.inject({
    method: "POST",
    url: "/admin/remittances",
    headers: operator.headers,
    payload: batch([line]),
  });

  const again = json(
    await app.server.inject({
      method: "POST",
      url: "/admin/remittances",
      headers: operator.headers,
      payload: batch([line], { batchId: "BLUEDART-2026-08-04" }),
    }),
  );

  assert.equal(again.counts.duplicate, 1);
  // A duplicate contributes nothing, or the expected total doubles — the exact
  // double-count this check exists to catch.
  assert.equal(again.expected, 0);
});

apiTest("refuses a collection nobody was owed", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  const prepaid = await placeAndMove("upi", "SIU-PS-GLD", ["confirmed"]);
  const inFlight = await placeAndMove("cod", "SIU-TB-12", ["confirmed", "processing", "shipped"]);

  const result = json(
    await app.server.inject({
      method: "POST",
      url: "/admin/remittances",
      headers: operator.headers,
      payload: batch([
        { orderNumber: "SIU-99999", collected: 100000, deductions: 0, remitted: 100000 },
        { orderNumber: prepaid.orderNumber, collected: 100000, deductions: 0, remitted: 100000 },
        { orderNumber: inFlight.orderNumber, collected: 100000, deductions: 0, remitted: 100000 },
      ]),
    }),
  );

  assert.equal(result.counts.unknown_order, 1);
  assert.equal(result.counts.not_cod, 1);
  assert.equal(result.counts.not_delivered, 1);
  // Worst first: an order that does not exist outranks one that was prepaid.
  assert.deepEqual(
    result.exceptions.map((entry: { outcome: string }) => entry.outcome),
    ["unknown_order", "not_delivered", "not_cod"],
  );
});

apiTest("spots a parcel billed on more weight than it was booked at", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  const order = await deliveredCod();

  const result = json(
    await app.server.inject({
      method: "POST",
      url: "/admin/remittances",
      headers: operator.headers,
      payload: batch([
        {
          orderNumber: order.number,
          collected: order.total,
          // A third of the order kept as freight on a piece of jewellery is a
          // mis-weigh, not a rate.
          deductions: Math.round(order.total * 0.4),
          remitted: order.total - Math.round(order.total * 0.4),
          declaredWeightGrams: 200,
          chargedWeightGrams: 500,
        },
      ]),
    }),
  );

  assert.equal(result.weightDisputes[0].excessWeightGrams, 300);
  assert.equal(result.deductionAlarms.length, 1);
});

apiTest("separates cash in the bank from cash the courier is holding", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  const settled = await deliveredCod();
  const awaiting = await deliveredCod("SIU-JH-GLD");

  await app.server.inject({
    method: "POST",
    url: "/admin/remittances",
    headers: operator.headers,
    payload: batch([
      {
        orderNumber: settled.number,
        collected: settled.total,
        deductions: 6500,
        remitted: settled.total - 6500,
      },
    ]),
  });

  const cash = json(
    await app.server.inject({
      method: "GET",
      url: "/admin/cash-position",
      headers: operator.headers,
    }),
  );

  assert.equal(cash.codRemitted, settled.total);
  // Revenue on the books, nothing in the bank. Reading order status alone would
  // count both as paid, which is the number that is wrong.
  assert.equal(cash.codAwaitingRemittance, awaiting.total);
});

apiTest("reports batches and the open exception queue", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  const order = await deliveredCod();

  await app.server.inject({
    method: "POST",
    url: "/admin/remittances",
    headers: operator.headers,
    payload: batch([
      {
        orderNumber: order.number,
        collected: order.total - 4900,
        deductions: 6500,
        remitted: order.total - 4900 - 6500,
      },
    ]),
  });

  const report = json(
    await app.server.inject({
      method: "GET",
      url: "/admin/remittances?batchId=BLUEDART-2026-07-28",
      headers: operator.headers,
    }),
  );

  assert.equal(report.batches.length, 1);
  assert.equal(report.batches[0].courier, "Bluedart");
  assert.equal(report.batches[0].shortfall, 4900);
  assert.equal(report.exceptions.length, 1);
  assert.equal(report.exceptions[0].outcome, "short");
  // Named, not just counted. Raw SQL comes back in the database's snake_case,
  // and an operator handed a queue of blank rows cannot work it.
  assert.equal(report.exceptions[0].orderNumber, order.number);
  assert.equal(report.exceptions[0].variance, -4900);
  assert.equal(report.ledger.length, 1);
});

apiTest("refuses a batch with no rows rather than recording an empty one", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  const response = await app.server.inject({
    method: "POST",
    url: "/admin/remittances",
    headers: operator.headers,
    payload: batch([]),
  });
  assert.equal(response.statusCode, 500);
});

apiTest("keeps the remittance desk away from a customer", async () => {
  const shopper = await signIn("9812340002");
  for (const url of ["/admin/remittances", "/admin/cash-position"]) {
    const response = await app.server.inject({
      method: "GET",
      url,
      headers: shopper.headers,
    });
    assert.equal(response.statusCode, 403, url);
  }

  const write = await app.server.inject({
    method: "POST",
    url: "/admin/remittances",
    headers: shopper.headers,
    payload: batch([
      { orderNumber: "SIU-00001", collected: 1, deductions: 0, remitted: 1 },
    ]),
  });
  assert.equal(write.statusCode, 403);
});

// ── Security headers and rate limits ──────────────────────────

apiTest("sends the browser policy on every reply", async () => {
  const response = await app.server.inject({ method: "GET", url: "/health" });

  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  // This service returns JSON and loads nothing, so the honest policy is that
  // it may load nothing — an error page rendered by a proxy cannot pull a
  // script in.
  assert.match(response.headers["content-security-policy"] as string, /default-src 'none'/);
  assert.match(response.headers["content-security-policy"] as string, /frame-ancestors 'none'/);
});

apiTest("does not pin a plain-HTTP origin to https", async () => {
  // HSTS is a promise a browser keeps for a year. Sent from a development
  // origin it pins that browser to an https://localhost that does not exist.
  const response = await app.server.inject({ method: "GET", url: "/health" });
  assert.equal(response.headers["strict-transport-security"], undefined);
});

apiTest("refuses a flood of sign-in attempts from one origin", async () => {
  // Its own app, with the limits the service actually ships. The shared one
  // above runs unlimited so the suite does not throttle itself.
  const limited = await buildApp({
    connectionString: testDb!.url,
    adminPhones: OPERATOR_PHONE,
    otpEcho: true,
  });

  try {
    const responses = [];
    for (let attempt = 0; attempt < 14; attempt += 1) {
      responses.push(
        await limited.server.inject({
          method: "POST",
          url: "/auth/otp",
          // A different number each time, so the per-phone throttle is not what
          // is being measured — this is the ceiling on the origin itself.
          payload: { phone: `98123${String(40000 + attempt)}` },
        }),
      );
    }

    const refused = responses.filter((response) => response.statusCode === 429);
    assert.ok(refused.length > 0, "the burst was refused at some point");
    assert.equal(json(refused[0]!).error, "rate_limited");
    // Retry-After, or a client has to guess and will guess "immediately".
    assert.ok(Number(refused[0]!.headers["retry-after"]) > 0);

    // A burst on a courier webhook is the courier catching up after an outage,
    // and refusing it drops parcel updates that will never be resent.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const health = await limited.server.inject({ method: "GET", url: "/health" });
      assert.equal(health.statusCode, 200, `health attempt ${attempt}`);
    }
  } finally {
    await limited.server.close();
    await limited.pool.end();
  }
});
