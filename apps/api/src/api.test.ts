import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createTestDatabase, type TestDatabase } from "@siumora/db";

import { seed } from "../../../packages/db/src/seed.ts";

import { buildApp, type App } from "./app.ts";
import { stepFor, totpCode, totpCodeAtStep } from "@siumora/core";

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
    "TRUNCATE audit_log; DELETE FROM admin_totp; DELETE FROM notifications; DELETE FROM notification_preferences; DELETE FROM ndr_events; DELETE FROM return_requests; DELETE FROM cod_remittances; DELETE FROM privacy_requests; DELETE FROM tracking_events; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM cart_lines; DELETE FROM carts; DELETE FROM idempotency_keys; DELETE FROM sessions; DELETE FROM otp_challenges; DELETE FROM customers;",
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

apiTest("serves the catalogue review-free until customers write them", async () => {
  const list = json(await app.server.inject({ method: "GET", url: "/products" }));
  assert.equal(list.products.length, 4);

  const one = json(
    await app.server.inject({ method: "GET", url: "/products/petal-studs" }),
  );
  assert.equal(one.product.handle, "petal-studs");
  // The seed ships no reviews — a fabricated verifiedBuyer five-star would
  // flow straight into aggregateRating structured data (launch gate box 8).
  assert.equal(one.reviews.length, 0);
  assert.equal(one.rating.average, null);
  assert.equal(one.rating.count, 0);
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

// ── Data-principal rights ─────────────────────────────────────

apiTest("hands a signed-in person everything held about them", async () => {
  const buyer = await signIn("9812340003");
  const { cartId } = await newCartWith("SIU-PS-GLD");
  await app.server.inject({
    method: "POST",
    url: "/checkout",
    headers: buyer.headers,
    payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
  });

  const response = await app.server.inject({
    method: "GET",
    url: "/account/data",
    headers: buyer.headers,
  });
  const data = json(response);

  assert.equal(data.customer.phone, "9812340003");
  assert.equal(data.orders.length, 1);
  assert.equal(data.orders[0].lines.length, 1);
  // The retention notice travels with the file: told "here is your data" while
  // an invoice is kept for six years, a person has been half-answered.
  assert.ok(data.retained.some((entry: { because: string }) => /CGST Act/.test(entry.because)));
  // A file to keep, not a page to read over somebody's shoulder.
  assert.match(response.headers["content-disposition"] as string, /attachment/);
});

apiTest("does not put a live credential in the export", async () => {
  const buyer = await signIn("9812340004");
  const { cartId } = await newCartWith("SIU-PS-GLD");
  await app.server.inject({
    method: "POST",
    url: "/checkout",
    headers: buyer.headers,
    payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
  });

  const data = json(
    await app.server.inject({
      method: "GET",
      url: "/account/data",
      headers: buyer.headers,
    }),
  );

  // The access key authorises reading the order, and an export is a file
  // people forward. The session token likewise: handing it back turns a
  // privacy right into an account takeover.
  assert.equal(data.orders[0].accessKey, undefined);
  assert.equal(JSON.stringify(data.sessions).includes(buyer.token), false);
});

apiTest("refuses an export to someone who is not signed in", async () => {
  const response = await app.server.inject({ method: "GET", url: "/account/data" });
  assert.equal(response.statusCode, 401);
});

apiTest("erases a settled customer and keeps the invoice", async () => {
  const buyer = await signIn("9812340005");
  const { cartId } = await newCartWith("SIU-PS-GLD");
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      headers: buyer.headers,
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

  const result = json(
    await app.server.inject({
      method: "POST",
      url: "/account/erasure",
      headers: buyer.headers,
    }),
  );
  assert.equal(result.erased, true);

  const { rows } = await app.pool.query(
    "SELECT address, invoice_number, total, cgst, sgst, ga_client_id FROM orders WHERE number = $1",
    [placed.orderNumber],
  );
  // The person is gone from the address...
  assert.equal(rows[0].address.name, "[erased]");
  assert.equal(rows[0].address.phone, "[erased]");
  assert.equal(rows[0].address.line1, "[erased]");
  assert.equal(rows[0].ga_client_id, null);
  // ...and the tax record is untouched. Erasing it to satisfy the privacy law
  // would break the tax law.
  assert.ok(rows[0].invoice_number);
  assert.ok(rows[0].total > 0);
  assert.equal(rows[0].address.state_code ?? rows[0].address.stateCode, "27");
});

apiTest("will not erase while a parcel is still moving", async () => {
  // Erasing mid-flight strands the goods and the money both: the courier needs
  // an address to deliver to and a phone to ring.
  const buyer = await signIn("9812340006");
  const { cartId } = await newCartWith("SIU-PS-GLD");
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      headers: buyer.headers,
      payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
    }),
  );
  for (const status of ["confirmed", "processing", "shipped"]) {
    await app.server.inject({
      method: "POST",
      url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
      payload: { status },
    });
  }

  const result = json(
    await app.server.inject({
      method: "POST",
      url: "/account/erasure",
      headers: buyer.headers,
    }),
  );

  assert.equal(result.erased, false);
  assert.match(result.pendingBecause, /still in progress/);
  // Open, not refused: it becomes possible when the parcel lands, and the
  // deadline keeps running until it does.
  assert.ok(result.resolveBy);

  const { rows } = await app.pool.query(
    "SELECT address FROM orders WHERE number = $1",
    [placed.orderNumber],
  );
  assert.equal(rows[0].address.name, ADDRESS.name);
});

apiTest("does not restart the clock when somebody asks twice", async () => {
  const buyer = await signIn("9812340007");
  const { cartId } = await newCartWith("SIU-PS-GLD");
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      headers: buyer.headers,
      payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
    }),
  );
  await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
    payload: { status: "confirmed" },
  });

  const first = json(
    await app.server.inject({
      method: "POST",
      url: "/account/erasure",
      headers: buyer.headers,
    }),
  );
  const second = json(
    await app.server.inject({
      method: "POST",
      url: "/account/erasure",
      headers: buyer.headers,
    }),
  );

  assert.equal(second.alreadyOpen, true);
  assert.equal(second.requestId, first.requestId);
  // Impatience is not a second right, and a clock that resets on every tap
  // never runs out.
  assert.equal(second.resolveBy, first.resolveBy);
});

apiTest("signs an erased person out everywhere", async () => {
  const buyer = await signIn("9812340008");
  await app.server.inject({
    method: "POST",
    url: "/account/erasure",
    headers: buyer.headers,
  });

  // The session was the only thing tying the token to a person, and the person
  // is gone.
  const after = await app.server.inject({
    method: "GET",
    url: "/account/data",
    headers: buyer.headers,
  });
  assert.equal(after.statusCode, 401);
});

apiTest("does not leave a queued conversion carrying an erased identity", async () => {
  const buyer = await signIn("9812340009");
  const { cartId } = await newCartWith("SIU-PS-GLD");
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      headers: buyer.headers,
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
  // Force the ledger rows back into the queue, as a configured environment
  // would have left them.
  await app.pool.query("UPDATE tracking_events SET status = 'pending'");

  await app.server.inject({
    method: "POST",
    url: "/account/erasure",
    headers: buyer.headers,
  });

  const { rows } = await app.pool.query(
    "SELECT status, payload FROM tracking_events WHERE status = 'pending'",
  );
  // A hashed phone number in a queued payload is still an identifier, and a
  // worker draining after the erasure would send it.
  assert.equal(rows.length, 0);
});

apiTest("puts the queue and its deadline in front of an operator", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  const buyer = await signIn("9812340010");
  const { cartId } = await newCartWith("SIU-PS-GLD");
  const placed = json(
    await app.server.inject({
      method: "POST",
      url: "/checkout",
      headers: buyer.headers,
      payload: { cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
    }),
  );
  await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
    payload: { status: "confirmed" },
  });
  await app.server.inject({
    method: "POST",
    url: "/account/erasure",
    headers: buyer.headers,
  });

  const queue = json(
    await app.server.inject({
      method: "GET",
      url: "/admin/privacy-requests",
      headers: operator.headers,
    }),
  );

  assert.equal(queue.requests.length, 1);
  assert.equal(queue.requests[0].kind, "erasure");
  assert.ok(queue.requests[0].resolveBy, "the deadline is the regulated part");
  assert.match(queue.requests[0].note, /still in progress/);

  // An operator cannot override the live-order check: the override would
  // strand the parcel, and the operator is who has to sort that out.
  const forced = await app.server.inject({
    method: "POST",
    url: `/admin/privacy-requests/${queue.requests[0].id}/complete`,
    headers: operator.headers,
  });
  assert.equal(forced.statusCode, 409);
});

apiTest("keeps the privacy queue away from a customer", async () => {
  const shopper = await signIn("9812340011");
  const response = await app.server.inject({
    method: "GET",
    url: "/admin/privacy-requests",
    headers: shopper.headers,
  });
  assert.equal(response.statusCode, 403);
});

// ── Roles and the audit log ───────────────────────────────────

/** An app with three distinct roles, so a refusal proves the role and not luck. */
async function rolesApp() {
  return buildApp({
    connectionString: testDb!.url,
    adminPhones: "9000000001:owner,9000000002:operator,9000000003:viewer",
    otpEcho: true,
    courierSimulation: true,
    rateLimiter: createRateLimiter([]),
  });
}

apiTest("keeps a packer away from the things that cannot be undone", async () => {
  const roles = await rolesApp();
  try {
    const signInAs = async (phone: string) => {
      const issued = json(
        await roles.server.inject({ method: "POST", url: "/auth/otp", payload: { phone } }),
      );
      const verified = json(
        await roles.server.inject({
          method: "POST",
          url: "/auth/verify",
          payload: { phone, code: issued.code },
        }),
      );
      return { authorization: `Bearer ${verified.token}` };
    };

    const owner = await signInAs("9000000001");
    const operator = await signInAs("9000000002");
    const viewer = await signInAs("9000000003");

    // Everyone on the list can read the dashboard.
    for (const [label, headers] of [["owner", owner], ["operator", operator], ["viewer", viewer]] as const) {
      const response = await roles.server.inject({
        method: "GET",
        url: "/admin/metrics",
        headers,
      });
      assert.equal(response.statusCode, 200, label);
    }

    // A GSTR-1 export is every customer's state and every registered buyer's
    // GSTIN in one file.
    const gstPath = `/admin/gstr1?period=${thisPeriod()}`;
    assert.equal((await roles.server.inject({ method: "GET", url: gstPath, headers: owner })).statusCode, 200);
    assert.equal((await roles.server.inject({ method: "GET", url: gstPath, headers: operator })).statusCode, 403);

    // Erasure is irreversible.
    assert.equal(
      (await roles.server.inject({ method: "GET", url: "/admin/privacy-requests", headers: operator })).statusCode,
      403,
    );

    // The everyday job stays available to the everyday role.
    assert.equal(
      (await roles.server.inject({ method: "GET", url: "/admin/restock-queue", headers: operator })).statusCode,
      200,
    );
    assert.equal(
      (await roles.server.inject({ method: "GET", url: "/admin/restock-queue", headers: viewer })).statusCode,
      403,
    );
  } finally {
    await roles.server.close();
    await roles.pool.end();
  }
});

apiTest("names the permission it is refusing for", async () => {
  const roles = await rolesApp();
  try {
    const issued = json(
      await roles.server.inject({
        method: "POST",
        url: "/auth/otp",
        payload: { phone: "9000000002" },
      }),
    );
    const verified = json(
      await roles.server.inject({
        method: "POST",
        url: "/auth/verify",
        payload: { phone: "9000000002", code: issued.code },
      }),
    );

    const response = await roles.server.inject({
      method: "GET",
      url: `/admin/gstr1?period=${thisPeriod()}`,
      headers: { authorization: `Bearer ${verified.token}` },
    });

    // Told only "no", an operator asks an owner to try it too — two people's
    // time to learn one fact.
    const body = json(response);
    assert.equal(body.error, "insufficient_role");
    assert.equal(body.needs, "gst:read");
    assert.equal(body.role, "operator");
  } finally {
    await roles.server.close();
    await roles.pool.end();
  }
});

apiTest("records who moved an order, and does not blame the courier on a person", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  const placed = await placeAndMove("upi", "SIU-PS-GLD", []);

  await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/status`,
    headers: operator.headers,
    payload: { status: "confirmed" },
  });
  // The same route, driven by the courier simulation with no operator session.
  await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
    payload: { status: "processing" },
  });

  const { rows } = await app.pool.query(
    "SELECT action, subject, detail, actor_phone, actor_role FROM audit_log ORDER BY created_at",
  );

  // One entry, not two: putting somebody's name against a move they never made
  // is worse than not logging it.
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "order.status");
  assert.equal(rows[0].subject, placed.orderNumber);
  assert.equal(rows[0].detail.to, "confirmed");
  assert.equal(rows[0].actor_phone, OPERATOR_PHONE);
  assert.equal(rows[0].actor_role, "owner");
});

apiTest("records a remittance batch and a bulk export", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  const order = await deliveredCod();

  await app.server.inject({
    method: "POST",
    url: "/admin/remittances",
    headers: operator.headers,
    payload: batch([
      {
        orderNumber: order.number,
        collected: order.total,
        deductions: 6500,
        remitted: order.total - 6500,
      },
    ]),
  });
  await app.server.inject({
    method: "GET",
    url: `/admin/gstr1?period=${thisPeriod()}`,
    headers: operator.headers,
  });

  const { rows } = await app.pool.query(
    "SELECT action, subject FROM audit_log ORDER BY created_at",
  );
  const actions = rows.map((row: { action: string }) => row.action);

  assert.ok(actions.includes("remittance.ingest"));
  // A read, recorded unusually: a bulk export of customer data is worth knowing
  // about even though it changed nothing.
  assert.ok(actions.includes("gst.export"));
});

// Regression (d): the guard at orders.ts — with the simulation off, a viewer
// without orders:write must not be able to move a parcel. Marking your own
// order delivered opens the return window and recognises the revenue.
apiTest("refuses a customer-driven transition when the courier simulation is off", async () => {
  const placed = await placeAndMove("upi", "SIU-PS-GLD", []);

  // A second app on the same database with the simulation off — the global
  // test app keeps it on because the delivered/NDR paths depend on it.
  const noSim = await buildApp({
    connectionString: testDb!.url,
    otpEcho: true,
    courierSimulation: false,
    rateLimiter: createRateLimiter([]),
  });
  try {
    // The buyer's own access key: authorised as the order's owner, so this is
    // literally the customer trying to move their own parcel.
    const response = await noSim.server.inject({
      method: "POST",
      url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
      payload: { status: "confirmed" },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(json(response).error, "not_an_operator");
  } finally {
    await noSim.server.close();
    await noSim.pool.end();
  }
});

apiTest("will not let the application rewrite its own log", async () => {
  // The credentials worth stealing are the application's. A log those
  // credentials can edit is not evidence, so the database refuses.
  const operator = await signIn(OPERATOR_PHONE);
  const placed = await placeAndMove("upi", "SIU-PS-GLD", []);
  await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/status`,
    headers: operator.headers,
    payload: { status: "confirmed" },
  });

  await app.pool.query("UPDATE audit_log SET action = 'order.restock'");
  await app.pool.query("DELETE FROM audit_log");

  const { rows } = await app.pool.query("SELECT action FROM audit_log");
  assert.equal(rows.length, 1, "the delete did nothing");
  assert.equal(rows[0].action, "order.status", "the update did nothing");
});

apiTest("shows an operator the log without the phone numbers", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  const placed = await placeAndMove("upi", "SIU-PS-GLD", []);
  await app.server.inject({
    method: "POST",
    url: `/orders/${placed.orderNumber}/status`,
    headers: operator.headers,
    payload: { status: "confirmed" },
  });

  const log = json(
    await app.server.inject({
      method: "GET",
      url: "/admin/audit",
      headers: operator.headers,
    }),
  );

  assert.equal(log.entries.length, 1);
  assert.equal(log.entries[0].action, "order.status");
  // Full numbers stay in the table for accountability; a screen anybody can
  // shoulder-surf does not need them.
  assert.equal(log.entries[0].actorPhone.includes(OPERATOR_PHONE), false);
  assert.match(log.entries[0].actorPhone, /•/);
});

apiTest("tells the dashboard what this operator may do", async () => {
  const operator = await signIn(OPERATOR_PHONE);
  const metrics = json(
    await app.server.inject({
      method: "GET",
      url: "/admin/metrics",
      headers: operator.headers,
    }),
  );

  // A button that 403s on click is worse than a button that is not there.
  assert.equal(metrics.role, "owner");
  assert.ok(metrics.permissions.includes("gst:read"));
});

// ── Tax invoice PDF ───────────────────────────────────────────

/** An app with the seller's registered details filled in. */
async function invoiceApp() {
  return buildApp({
    connectionString: testDb!.url,
    adminPhones: OPERATOR_PHONE,
    otpEcho: true,
    courierSimulation: true,
    rateLimiter: createRateLimiter([]),
    seller: {
      name: "Siumora Jewels Private Limited",
      address: "12 Kala Ghoda, Fort, Mumbai 400001",
      gstin: "27AAPFU0939F1ZV",
      stateCode: "27",
      email: "hello@siumora.example",
      phone: "9000000001",
    },
  });
}

apiTest("serves the tax invoice as a PDF", async () => {
  const invoicing = await invoiceApp();
  try {
    const cart = json(await invoicing.server.inject({ method: "POST", url: "/carts" }));
    const products = json(
      await invoicing.server.inject({ method: "GET", url: "/products" }),
    );
    const variant = products.products
      .flatMap((p: { variants: Array<{ id: string; sku: string }> }) => p.variants)
      .find((v: { sku: string }) => v.sku === "SIU-PS-GLD");
    await invoicing.server.inject({
      method: "POST",
      url: `/carts/${cart.cartId}/lines`,
      payload: { variantId: variant.id, quantity: 1 },
    });
    const placed = json(
      await invoicing.server.inject({
        method: "POST",
        url: "/checkout",
        payload: { cartId: cart.cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
      }),
    );
    await invoicing.server.inject({
      method: "POST",
      url: `/orders/${placed.orderNumber}/status?key=${placed.accessKey}`,
      payload: { status: "confirmed" },
    });

    const response = await invoicing.server.inject({
      method: "GET",
      url: `/orders/${placed.orderNumber}/invoice.pdf?key=${placed.accessKey}`,
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] as string, /application\/pdf/);
    assert.match(
      response.headers["content-disposition"] as string,
      new RegExp(`filename="invoice-${placed.orderNumber}\\.pdf"`),
    );

    const body = response.rawPayload;
    // A real PDF, not an error page that happened to get the header.
    assert.equal(body.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.ok(body.includes(Buffer.from("%%EOF")), "the file is terminated");

    const text = body.toString("latin1");
    for (const required of [
      "TAX INVOICE",
      "27AAPFU0939F1ZV",
      "Siumora Jewels Private Limited",
      "Asha Menon",
      "Amount in words",
      "Declaration",
      "7113",
    ]) {
      assert.ok(text.includes(required), required);
    }
  } finally {
    await invoicing.server.close();
    await invoicing.pool.end();
  }
});

apiTest("will not issue an invoice for an order that never raised one", async () => {
  const invoicing = await invoiceApp();
  try {
    const cart = json(await invoicing.server.inject({ method: "POST", url: "/carts" }));
    const products = json(
      await invoicing.server.inject({ method: "GET", url: "/products" }),
    );
    const variant = products.products
      .flatMap((p: { variants: Array<{ id: string; sku: string }> }) => p.variants)
      .find((v: { sku: string }) => v.sku === "SIU-PS-GLD");
    await invoicing.server.inject({
      method: "POST",
      url: `/carts/${cart.cartId}/lines`,
      payload: { variantId: variant.id, quantity: 1 },
    });
    // Placed but never confirmed, so no number was allocated.
    const placed = json(
      await invoicing.server.inject({
        method: "POST",
        url: "/checkout",
        payload: { cartId: cart.cartId, address: ADDRESS, paymentMethod: "upi", eventId: crypto.randomUUID() },
      }),
    );

    const response = await invoicing.server.inject({
      method: "GET",
      url: `/orders/${placed.orderNumber}/invoice.pdf?key=${placed.accessKey}`,
    });

    // Producing a document here would be issuing an invoice outside the series.
    assert.equal(response.statusCode, 409);
    assert.equal(json(response).error, "no_invoice");
  } finally {
    await invoicing.server.close();
    await invoicing.pool.end();
  }
});

apiTest("refuses to print a tax invoice for an unconfigured seller", async () => {
  // A document with a dash where the registration number belongs looks official
  // enough that nobody would check it.
  const placed = await placeAndMove("upi", "SIU-PS-GLD", ["confirmed"]);
  const response = await app.server.inject({
    method: "GET",
    url: `/orders/${placed.orderNumber}/invoice.pdf?key=${placed.accessKey}`,
  });

  assert.equal(response.statusCode, 503);
  assert.equal(json(response).error, "seller_not_configured");
});

apiTest("keeps an invoice away from someone holding only the order number", async () => {
  // An invoice carries the buyer's name, address and phone. Checking only the
  // number would make this a directory of everyone who has ever bought here.
  const placed = await placeAndMove("upi", "SIU-PS-GLD", ["confirmed"]);
  const response = await app.server.inject({
    method: "GET",
    url: `/orders/${placed.orderNumber}/invoice.pdf`,
  });
  assert.equal(response.statusCode, 404);
});

// ── Admin second factor ───────────────────────────────────────

/** An app that can actually seal a TOTP secret. */
async function twoFactorApp() {
  return buildApp({
    connectionString: testDb!.url,
    adminPhones: OPERATOR_PHONE,
    otpEcho: true,
    courierSimulation: true,
    rateLimiter: createRateLimiter([]),
    totpEncryptionKey: "a-development-key-long-enough",
  });
}

async function signInTo(app2: Awaited<ReturnType<typeof buildApp>>, phone: string) {
  // These tests sign the same operator in several times to get distinct
  // sessions, and the resend cooldown is per phone. Clearing the challenges is
  // the test getting out of its own way, not a hole in the throttle.
  await app2.pool.query("DELETE FROM otp_challenges WHERE phone = $1", [phone]);
  const issued = json(
    await app2.server.inject({ method: "POST", url: "/auth/otp", payload: { phone } }),
  );
  const verified = json(
    await app2.server.inject({
      method: "POST",
      url: "/auth/verify",
      payload: { phone, code: issued.code },
    }),
  );
  return { authorization: `Bearer ${verified.token}` };
}

apiTest("enrols a second factor and enforces it thereafter", async () => {
  const app2 = await twoFactorApp();
  try {
    await app2.pool.query("DELETE FROM admin_totp");
    const headers = await signInTo(app2, OPERATOR_PHONE);

    // Before enrolment nothing is enforced — a control that locks out every
    // operator the day it ships is one somebody turns off.
    assert.equal(
      (await app2.server.inject({ method: "GET", url: "/admin/metrics", headers })).statusCode,
      200,
    );

    const started = json(
      await app2.server.inject({ method: "POST", url: "/admin/2fa/enrol", headers }),
    );
    assert.match(started.uri, /^otpauth:\/\/totp\//);
    assert.equal(started.recoveryCodes.length, 8);

    // Still not enforced: the enrolment is unconfirmed, so an operator who
    // scanned a code that does not work is not locked out by their own attempt.
    assert.equal(
      (await app2.server.inject({ method: "GET", url: "/admin/metrics", headers })).statusCode,
      200,
    );

    const confirmed = await app2.server.inject({
      method: "POST",
      url: "/admin/2fa/confirm",
      headers,
      payload: { code: totpCode(started.secret) },
    });
    assert.equal(confirmed.statusCode, 200);

    // Confirming stepped this session up, so it keeps working.
    assert.equal(
      (await app2.server.inject({ method: "GET", url: "/admin/metrics", headers })).statusCode,
      200,
    );

    // A different session has not passed the factor.
    const fresh = await signInTo(app2, OPERATOR_PHONE);
    const refused = await app2.server.inject({
      method: "GET",
      url: "/admin/metrics",
      headers: fresh,
    });
    assert.equal(refused.statusCode, 403);
    assert.equal(json(refused).error, "two_factor_required");

    const stepped = await app2.server.inject({
      method: "POST",
      url: "/admin/2fa/verify",
      headers: fresh,
      // The next step's code, not this one's: confirming already spent the
      // current counter, and the replay guard is right to refuse it.
      payload: { code: totpCodeAtStep(started.secret, stepFor(new Date()) + 1) },
    });
    assert.equal(stepped.statusCode, 200);
    assert.equal(
      (await app2.server.inject({ method: "GET", url: "/admin/metrics", headers: fresh })).statusCode,
      200,
    );
  } finally {
    await app2.pool.query("DELETE FROM admin_totp");
    await app2.server.close();
    await app2.pool.end();
  }
});

apiTest("will not accept the same code twice", async () => {
  // A TOTP is valid for thirty seconds and would otherwise work twice inside
  // that window — which is exactly long enough for somebody reading it over a
  // shoulder, or replaying a captured request.
  const app2 = await twoFactorApp();
  try {
    await app2.pool.query("DELETE FROM admin_totp");
    const headers = await signInTo(app2, OPERATOR_PHONE);
    const started = json(
      await app2.server.inject({ method: "POST", url: "/admin/2fa/enrol", headers }),
    );
    const code = totpCode(started.secret);

    await app2.server.inject({
      method: "POST",
      url: "/admin/2fa/confirm",
      headers,
      payload: { code },
    });

    const fresh = await signInTo(app2, OPERATOR_PHONE);
    const replayed = await app2.server.inject({
      method: "POST",
      url: "/admin/2fa/verify",
      headers: fresh,
      payload: { code },
    });

    assert.equal(replayed.statusCode, 400);
    assert.equal(json(replayed).reason, "replayed");
  } finally {
    await app2.pool.query("DELETE FROM admin_totp");
    await app2.server.close();
    await app2.pool.end();
  }
});

apiTest("lets a recovery code in exactly once", async () => {
  const app2 = await twoFactorApp();
  try {
    await app2.pool.query("DELETE FROM admin_totp");
    const headers = await signInTo(app2, OPERATOR_PHONE);
    const started = json(
      await app2.server.inject({ method: "POST", url: "/admin/2fa/enrol", headers }),
    );
    await app2.server.inject({
      method: "POST",
      url: "/admin/2fa/confirm",
      headers,
      payload: { code: totpCode(started.secret) },
    });

    const recovery = started.recoveryCodes[0];
    const fresh = await signInTo(app2, OPERATOR_PHONE);
    const used = await app2.server.inject({
      method: "POST",
      url: "/admin/2fa/verify",
      headers: fresh,
      payload: { code: recovery },
    });
    assert.equal(used.statusCode, 200);
    assert.equal(json(used).usedRecoveryCode, true);

    // Single-use, so one read off a screenshot works once.
    const another = await signInTo(app2, OPERATOR_PHONE);
    const again = await app2.server.inject({
      method: "POST",
      url: "/admin/2fa/verify",
      headers: another,
      payload: { code: recovery },
    });
    assert.equal(again.statusCode, 400);

    const state = json(
      await app2.server.inject({ method: "GET", url: "/admin/2fa", headers }),
    );
    assert.equal(state.recoveryCodesLeft, 7);
  } finally {
    await app2.pool.query("DELETE FROM admin_totp");
    await app2.server.close();
    await app2.pool.end();
  }
});

apiTest("will not swap a confirmed factor for a new one", async () => {
  // Otherwise anyone with a live session quietly replaces the second factor
  // with their own, and the control protects nothing.
  const app2 = await twoFactorApp();
  try {
    await app2.pool.query("DELETE FROM admin_totp");
    const headers = await signInTo(app2, OPERATOR_PHONE);
    const started = json(
      await app2.server.inject({ method: "POST", url: "/admin/2fa/enrol", headers }),
    );
    await app2.server.inject({
      method: "POST",
      url: "/admin/2fa/confirm",
      headers,
      payload: { code: totpCode(started.secret) },
    });

    const again = await app2.server.inject({
      method: "POST",
      url: "/admin/2fa/enrol",
      headers,
    });
    assert.equal(again.statusCode, 409);
  } finally {
    await app2.pool.query("DELETE FROM admin_totp");
    await app2.server.close();
    await app2.pool.end();
  }
});

apiTest("requires a live code to remove the factor", async () => {
  // A stolen session that could remove the factor completes the theft, which
  // is precisely what the factor was there to prevent.
  const app2 = await twoFactorApp();
  try {
    await app2.pool.query("DELETE FROM admin_totp");
    const headers = await signInTo(app2, OPERATOR_PHONE);
    const started = json(
      await app2.server.inject({ method: "POST", url: "/admin/2fa/enrol", headers }),
    );
    await app2.server.inject({
      method: "POST",
      url: "/admin/2fa/confirm",
      headers,
      payload: { code: totpCode(started.secret) },
    });

    const withoutCode = await app2.server.inject({
      method: "DELETE",
      url: "/admin/2fa",
      headers,
      payload: { code: "000000" },
    });
    assert.equal(withoutCode.statusCode, 400);

    const { rows } = await app2.pool.query("SELECT count(*)::int AS n FROM admin_totp");
    assert.equal(rows[0].n, 1, "still enrolled");
  } finally {
    await app2.pool.query("DELETE FROM admin_totp");
    await app2.server.close();
    await app2.pool.end();
  }
});

apiTest("refuses to store a second factor it cannot seal", async () => {
  // A plaintext shared secret is worse than no second factor, because it looks
  // like one.
  const operator = await signIn(OPERATOR_PHONE);
  const response = await app.server.inject({
    method: "POST",
    url: "/admin/2fa/enrol",
    headers: operator.headers,
  });

  assert.equal(response.statusCode, 503);
  assert.equal(json(response).error, "not_configured");
});

apiTest("never stores the TOTP secret in the clear", async () => {
  const app2 = await twoFactorApp();
  try {
    await app2.pool.query("DELETE FROM admin_totp");
    const headers = await signInTo(app2, OPERATOR_PHONE);
    const started = json(
      await app2.server.inject({ method: "POST", url: "/admin/2fa/enrol", headers }),
    );

    const { rows } = await app2.pool.query("SELECT secret_sealed FROM admin_totp");
    // The dump that leaks this table also carries the hashed session tokens, so
    // a plaintext secret would fall at the same moment as what it protects.
    assert.equal(rows[0].secret_sealed.includes(started.secret), false);
    assert.match(rows[0].secret_sealed, /^v1\./);
  } finally {
    await app2.pool.query("DELETE FROM admin_totp");
    await app2.server.close();
    await app2.pool.end();
  }
});
