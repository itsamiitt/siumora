import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createTestDatabase, type TestDatabase } from "@siumora/db";
import { ApiError, SiumoraClient, createClient } from "@siumora/sdk";
import { collectionSchema, productSchema } from "@siumora/core";

import { seed } from "../../../packages/db/src/seed.ts";

import { buildApp, type App } from "./app.ts";
import { createRateLimiter } from "./lib/rate-limit.ts";

/**
 * SDK contract suite (design doc M1): the adapter is a project, and this is
 * its bar. Every SiumoraClient method is driven against the real Fastify app
 * and its return shape pinned — when the Medusa transport lands, the same
 * suite runs against it and a shape diff is a failure, not a surprise in the
 * storefront. The client's injected fetch rides server.inject, so this is
 * the same code path a live request takes, without a port.
 */
const url = process.env.DATABASE_URL;
const contractTest = url ? test : test.skip;

const OPERATOR_PHONE = "9000000001";
const CUSTOMER_PHONE = "9812345678";

let testDb: TestDatabase | undefined;
let app: App;
let client: SiumoraClient;

/** Bridge WHATWG fetch onto server.inject — the transport under test stays real. */
function injectFetch(target: () => App): typeof globalThis.fetch {
  return async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(raw);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const response = await target().server.inject({
      method: (init?.method ?? "GET") as "GET",
      url: parsed.pathname + parsed.search,
      headers,
      ...(init?.body !== undefined && init.body !== null
        ? { payload: init.body as string }
        : {}),
    });
    return new Response(response.rawPayload, {
      status: response.statusCode,
      headers: response.headers as Record<string, string>,
    });
  };
}

before(async () => {
  if (!url) return;
  testDb = await createTestDatabase("sdk-contract");
  app = await buildApp({
    connectionString: testDb!.url,
    corsOrigins: ["http://localhost:3000"],
    razorpayWebhookSecret: "test_razorpay_secret",
    courierWebhookSecret: "test_courier_secret",
    adminPhones: OPERATOR_PHONE,
    otpEcho: true,
    courierSimulation: true,
    rateLimiter: createRateLimiter([]),
    settingsTtlMs: 0,
    // Registered seller details, so the invoice-PDF contract is testable —
    // without them the route correctly refuses with 503 seller_not_configured.
    seller: {
      name: "Siumora Jewels Private Limited",
      address: "12 Kala Ghoda, Fort, Mumbai 400001",
      gstin: "27AAPFU0939F1ZV",
      stateCode: "27",
      email: "hello@siumora.example",
      phone: "9000000001",
    },
  });
  client = new SiumoraClient({ baseUrl: "http://contract.test", fetch: injectFetch(() => app) });
});

beforeEach(async () => {
  if (!url) return;
  await app.pool.query(
    "TRUNCATE audit_log; DELETE FROM settings; DELETE FROM admin_totp; DELETE FROM notifications; DELETE FROM notification_preferences; DELETE FROM ndr_events; DELETE FROM return_requests; DELETE FROM cod_remittances; DELETE FROM privacy_requests; DELETE FROM tracking_events; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM cart_lines; DELETE FROM carts; DELETE FROM idempotency_keys; DELETE FROM sessions; DELETE FROM otp_challenges; DELETE FROM customers;",
  );
  await seed(testDb!.url);
});

after(async () => {
  if (!app) return;
  await app.server.close();
  await app.pool.end();
});

/** Exact top-level shape: extra keys are as much a contract break as missing ones. */
function assertExactKeys(value: unknown, expected: string[], label: string) {
  assert.ok(value && typeof value === "object", `${label} is not an object`);
  assert.deepEqual(Object.keys(value as object).sort(), [...expected].sort(), label);
}

const ADDRESS = {
  name: "Asha Menon",
  phone: CUSTOMER_PHONE,
  line1: "Flat 3B, Sunrise Apartments, Linking Road",
  city: "Mumbai",
  stateCode: "27",
  pincode: "400001",
};

async function signedInClient(phone: string) {
  const issued = await client.requestOtp(phone);
  const verified = await client.verifyOtp(phone, issued.code!);
  return { client: client.withToken(verified.token), verified };
}

async function cartWithItem(quantity = 1) {
  const cartId = await client.createCart();
  const products = await client.listProducts();
  const variantId = products[0]!.variants[0]!.id;
  await client.addToCart(cartId, variantId, quantity);
  return { cartId, variantId };
}

async function placeCodOrder() {
  const { cartId, variantId } = await cartWithItem();
  const placed = await client.checkout({
    cartId,
    address: ADDRESS,
    paymentMethod: "cod",
    eventId: crypto.randomUUID(),
  });
  return { placed, variantId };
}

// ── Auth ──────────────────────────────────────────────────────

contractTest("requestOtp: envelope, and the echo-mode code", async () => {
  const issued = await client.requestOtp(CUSTOMER_PHONE);
  assertExactKeys(issued, ["ok", "maskedPhone", "expiresAt", "delivery", "code"], "requestOtp");
  assert.equal(issued.ok, true);
  assert.match(issued.code!, /^\d{6}$/);
  assert.ok(["sent", "not_configured"].includes(issued.delivery));
});

contractTest("verifyOtp: token, admin flag, and the customer card", async () => {
  const issued = await client.requestOtp(CUSTOMER_PHONE);
  const verified = await client.verifyOtp(CUSTOMER_PHONE, issued.code!);
  assertExactKeys(
    verified,
    ["ok", "token", "expiresAt", "isAdmin", "claimedOrders", "customer"],
    "verifyOtp",
  );
  assertExactKeys(
    verified.customer,
    ["id", "phone", "maskedPhone", "name", "email"],
    "verifyOtp.customer",
  );
  assert.equal(verified.isAdmin, false);
  assert.equal(typeof verified.claimedOrders, "number");
});

contractTest("getSession: both arms of the union", async () => {
  const anonymous = await client.getSession();
  assert.deepEqual(anonymous, { signedIn: false });

  const { client: signed } = await signedInClient(CUSTOMER_PHONE);
  const session = await signed.getSession();
  assertExactKeys(session, ["signedIn", "isAdmin", "customer"], "getSession");
});

contractTest("signOut, signOutEverywhere, updateProfile", async () => {
  const { client: signed } = await signedInClient(CUSTOMER_PHONE);

  const profile = await signed.updateProfile({ name: "Asha M", email: "asha@example.com" });
  assertExactKeys(profile, ["ok", "customer"], "updateProfile");
  assert.equal(profile.customer.name, "Asha M");

  const everywhere = await signed.signOutEverywhere();
  assertExactKeys(everywhere, ["ok", "revoked"], "signOutEverywhere");
  assert.ok(everywhere.revoked >= 1);

  await client.signOut(); // anonymous sign-out is a no-op that must stay 2xx
});

// ── Catalogue ─────────────────────────────────────────────────

contractTest("listProducts: every product validates against core's schema", async () => {
  const products = await client.listProducts();
  assert.ok(products.length > 0);
  for (const product of products) {
    const parsed = productSchema.safeParse(product);
    assert.ok(parsed.success, `product ${product.handle} broke the core schema`);
  }
  const searched = await client.listProducts({ q: "stud" });
  assert.ok(Array.isArray(searched));
});

contractTest("getProduct: full card, and undefined on a stale link", async () => {
  const products = await client.listProducts();
  const card = await client.getProduct(products[0]!.handle);
  assertExactKeys(card, ["product", "reviews", "rating"], "getProduct");
  assert.ok(productSchema.safeParse(card!.product).success);
  assert.ok(Array.isArray(card!.reviews));

  assert.equal(await client.getProduct("does-not-exist"), undefined);
});

contractTest("listCollections validates against core's schema", async () => {
  const collections = await client.listCollections();
  assert.ok(collections.length > 0);
  for (const collection of collections) {
    assert.ok(collectionSchema.safeParse(collection).success, collection.handle);
  }
});

contractTest("getPincode: the serviceability card", async () => {
  const pin = await client.getPincode("400001");
  assertExactKeys(
    pin,
    ["pincode", "city", "stateCode", "serviceable", "codAvailable", "estimatedDays", "rtoRateBps"],
    "getPincode",
  );
  assert.equal(pin.serviceable, true);
});

// ── Cart ──────────────────────────────────────────────────────

contractTest("cart lifecycle: create, add, read, requantify, clear", async () => {
  const { cartId, variantId } = await cartWithItem();

  const added = await client.addToCart(cartId, variantId, 1);
  assertExactKeys(added, ["ok", "count"], "addToCart");

  const cart = await client.getCart(cartId);
  assertExactKeys(cart, ["cartId", "lines", "totals"], "getCart");
  assertExactKeys(
    cart.totals,
    ["mrpTotal", "subtotal", "savings", "shipping", "codFee", "total", "gst", "itemCount"],
    "getCart.totals",
  );
  assert.equal(cart.totals.itemCount, 2);

  const requantified = await client.setCartQuantity(cartId, variantId, 1);
  assertExactKeys(requantified, ["ok", "count"], "setCartQuantity");

  await client.clearCart(cartId);
  const cleared = await client.getCart(cartId);
  assert.equal(cleared.lines.length, 0);
});

// ── Checkout ──────────────────────────────────────────────────

contractTest("quoteCheckout: the risk card", async () => {
  const { cartId } = await cartWithItem();
  const quote = await client.quoteCheckout({
    cartId,
    pincode: "400001",
    address: ADDRESS.line1,
    city: ADDRESS.city,
    stateCode: ADDRESS.stateCode,
    phone: CUSTOMER_PHONE,
  });
  assertExactKeys(
    quote,
    ["serviceable", "estimatedDays", "addressQuality", "rto", "cod", "phoneVerified"],
    "quoteCheckout",
  );
  assertExactKeys(quote.addressQuality, ["score", "issues", "needsReview"], "addressQuality");
  assertExactKeys(quote.rto, ["risk", "score"], "rto");
});

contractTest("checkout: COD envelope, order number format, access key", async () => {
  const { placed } = await placeCodOrder();
  assertExactKeys(
    placed,
    ["ok", "orderNumber", "status", "invoiceNumber", "accessKey"],
    "checkout (cod)",
  );
  assert.match(placed.orderNumber, /^SIU-\d{5}$/);
  assert.ok(placed.accessKey.length >= 16);
});

contractTest("checkout: the same idempotency key returns the same order", async () => {
  const { cartId } = await cartWithItem();
  const key = crypto.randomUUID();
  const input = {
    cartId,
    address: ADDRESS,
    paymentMethod: "cod" as const,
    eventId: crypto.randomUUID(),
  };
  const first = await client.checkout(input, key);
  const second = await client.checkout(input, key);
  assert.equal(second.orderNumber, first.orderNumber);
});

// ── Orders ────────────────────────────────────────────────────

contractTest("getOrder: guest key gets the card, no key gets undefined", async () => {
  const { placed } = await placeCodOrder();

  const order = await client.getOrder(placed.orderNumber, placed.accessKey);
  assertExactKeys(order, ["order", "invoice", "return"], "getOrder");
  assertExactKeys(order!.invoice, ["rows", "totals"], "getOrder.invoice");
  assert.equal(order!.return, null);

  assert.equal(await client.getOrder(placed.orderNumber), undefined);
  // A wrong-but-well-formed key is a 404 (undefined). A malformed key is a
  // 400 and throws — recorded contract, the Medusa transport must match it.
  assert.equal(await client.getOrder(placed.orderNumber, crypto.randomUUID()), undefined);
  await assert.rejects(
    client.getOrder(placed.orderNumber, "not-a-uuid"),
    (error: unknown) => error instanceof ApiError && error.status === 400,
  );
});

contractTest("listOrders: the signed-in customer's own orders", async () => {
  const { client: signed } = await signedInClient(CUSTOMER_PHONE);
  const cartId = await signed.createCart();
  const products = await signed.listProducts();
  await signed.addToCart(cartId, products[0]!.variants[0]!.id);
  await signed.checkout({
    cartId,
    address: ADDRESS,
    paymentMethod: "cod",
    eventId: crypto.randomUUID(),
  });

  const orders = await signed.listOrders();
  assert.equal(orders.length, 1);
});

contractTest("confirmOrder and advanceOrder ride the simulation", async () => {
  const { placed } = await placeCodOrder();

  // COD confirms at placement — confirming again is a 409 illegal_transition.
  // That IS the contract; the Medusa transport must refuse identically.
  assert.equal(placed.status, "confirmed");
  await assert.rejects(
    client.confirmOrder(placed.orderNumber, placed.accessKey),
    (error: unknown) =>
      error instanceof ApiError && error.status === 409 && error.code === "illegal_transition",
  );

  const advanced = await client.advanceOrder(
    placed.orderNumber,
    "processing",
    undefined,
    placed.accessKey,
  );
  assertExactKeys(advanced, ["ok", "order"], "advanceOrder");
});

contractTest("requestReturn on a delivered order", async () => {
  const { placed, variantId } = await placeCodOrder();
  for (const status of ["processing", "shipped", "out_for_delivery", "delivered"]) {
    await client.advanceOrder(placed.orderNumber, status, undefined, placed.accessKey);
  }

  const requested = await client.requestReturn(
    placed.orderNumber,
    { variantIds: [variantId], reason: "not_as_described", resolution: "refund" },
    placed.accessKey,
  );
  assertExactKeys(requested, ["ok", "return", "reversePickup"], "requestReturn");
});

// ── Wishlist ──────────────────────────────────────────────────

contractTest("wishlist toggle and read", async () => {
  const products = await client.listProducts();
  const wishlistId = crypto.randomUUID();

  const toggled = await client.toggleWishlist(wishlistId, products[0]!.handle);
  assertExactKeys(toggled, ["wishlisted", "count"], "toggleWishlist");
  assert.equal(toggled.wishlisted, true);

  const handles = await client.getWishlist(wishlistId);
  assert.deepEqual(handles, [products[0]!.handle]);
});

// ── Data-principal rights ─────────────────────────────────────

contractTest("exportMyData and requestErasure", async () => {
  const { client: signed } = await signedInClient(CUSTOMER_PHONE);

  const data = await signed.exportMyData();
  assert.ok(data && typeof data === "object");

  const erasure = await signed.requestErasure();
  assert.ok("requestId" in erasure && "erased" in erasure && "retained" in erasure);
  assert.ok(Array.isArray(erasure.retained));
});

// ── Admin ─────────────────────────────────────────────────────

contractTest("admin reads: metrics, audit, remittances, gstr1", async () => {
  const { client: operator } = await signedInClient(OPERATOR_PHONE);

  const metrics = await operator.getMetrics();
  assert.ok("revenue" in metrics, "metrics.revenue");

  const audit = await operator.getAuditLog();
  assert.ok(audit && typeof audit === "object");

  const remittances = await operator.getRemittanceReport();
  assert.ok(remittances && typeof remittances === "object");

  const now = new Date();
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const gstr1 = await operator.getGstr1(period);
  assert.ok(gstr1 && typeof gstr1 === "object");
});

contractTest("getStoreConfig: the kill-switch card", async () => {
  const config = await client.getStoreConfig();
  assertExactKeys(config, ["paymentsEnabled", "razorpayConfigured"], "getStoreConfig");
  assert.equal(typeof config.paymentsEnabled, "boolean");
});

// ── Invoice PDF ───────────────────────────────────────────────

contractTest("invoicePdf: bytes for the key-holder, 404 for anyone else", async () => {
  const { placed } = await placeCodOrder();

  const pdf = await client.invoicePdf(placed.orderNumber, placed.accessKey);
  assert.equal(pdf.ok, true);
  const magic = new TextDecoder().decode(new Uint8Array(pdf.body!).slice(0, 5));
  assert.equal(magic, "%PDF-");

  const refused = await client.invoicePdf(placed.orderNumber);
  assert.deepEqual(refused, { ok: false, status: 404 });
});

// ── Error contract and construction ───────────────────────────

contractTest("errors arrive as ApiError with a structured code", async () => {
  const cartId = await client.createCart();
  await assert.rejects(
    client.addToCart(cartId, crypto.randomUUID()),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(typeof error.status, "number");
      assert.equal(typeof error.code, "string");
      assert.notEqual(error.code, "");
      return true;
    },
  );
});

contractTest("withToken returns a new client; the original stays anonymous", async () => {
  const { verified } = await signedInClient(CUSTOMER_PHONE);
  const signed = client.withToken(verified.token);
  const before = await client.getSession();
  assert.deepEqual(before, { signedIn: false });
  const after = await signed.getSession();
  assert.equal(after.signedIn, true);
});

contractTest("createClient: refuses a missing base URL, honors API_URL", () => {
  assert.throws(() => createClient({}), /API_URL/);
  assert.ok(createClient({ API_URL: "http://example.test" }) instanceof SiumoraClient);
});
