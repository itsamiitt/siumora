import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createTestDatabase, type TestDatabase } from "@siumora/db";
import { ApiError, SiumoraClient, createClient } from "@siumora/sdk";
import { MedusaClient, NotPortedError, createMedusaClient } from "@siumora/sdk/medusa";
import { collectionSchema, productSchema } from "@siumora/core";

import { seed } from "../../../packages/db/src/seed.ts";

import { buildApp, type App } from "./app.ts";
import { createRateLimiter } from "./lib/rate-limit.ts";

/**
 * SDK contract suite (design doc M1/M5): the adapter is a project, and this
 * is its bar. Every client method is driven against a real transport and its
 * return shape pinned — a shape diff is a failure, not a surprise in the
 * storefront. The suite is parametrized over the transport:
 *
 * - Default (no env): the Fastify app via a server.inject fetch bridge —
 *   the same code path a live request takes, without a port. Gated on
 *   DATABASE_URL exactly as before.
 * - SDK_CONTRACT_BACKEND=medusa (plus MEDUSA_URL and MEDUSA_PUBLISHABLE_KEY):
 *   the same tests drive a live MedusaClient. Tests named in MEDUSA_PORTED
 *   assert the real shapes; every other test asserts the method refuses with
 *   NotPortedError (501 not_ported) — the refusal IS the recorded contract
 *   for an unported method, never a skip. As wave-2 ports land, a name moves
 *   into MEDUSA_PORTED and starts asserting real shapes; a listed test that
 *   still throws not_ported FAILS. Same philosophy as the E2E_BACKEND
 *   refusal: CI must never report "medusa contract green" for a suite that
 *   tested nothing.
 */
const BACKEND = process.env.SDK_CONTRACT_BACKEND ?? "fastify";
if (BACKEND !== "fastify" && BACKEND !== "medusa") {
  throw new Error(`SDK_CONTRACT_BACKEND must be fastify|medusa, got "${BACKEND}"`);
}
const usingFastify = BACKEND === "fastify";

const url = usingFastify ? process.env.DATABASE_URL : undefined;

/**
 * The contract tests the Medusa transport is expected to pass TODAY, verified
 * by running them against a live instance — reality, not intention. Everything
 * else must throw NotPortedError until its port lands. Auth-dependent flows
 * (signedInClient) are deliberately absent: medusa mode is anonymous-only
 * until the M1 phone-OTP auth provider ports, so those tests refuse at the
 * first auth call.
 */
const MEDUSA_PORTED = new Set<string>([
  "listProducts: every product validates against core's schema",
  "getProduct: full card, and undefined on a stale link",
  "listCollections validates against core's schema",
  "cart lifecycle: create, add, read, requantify, clear",
  "errors arrive as ApiError with a structured code",
  // Transport construction: the body branches — createClient on fastify,
  // its mirror createMedusaClient on medusa. Both arms are real assertions.
  "createClient: refuses a missing base URL, honors API_URL",
  // Wave 2: phone-OTP auth (provider + JWT dance) and the COD checkout /
  // guest order read over the siumora routes.
  "requestOtp: envelope, and the echo-mode code",
  "verifyOtp: token, admin flag, and the customer card",
  "getSession: both arms of the union",
  "withToken returns a new client; the original stays anonymous",
  "checkout: COD envelope, order number format, access key",
  "checkout: the same idempotency key returns the same order",
  "getOrder: guest key gets the card, no key gets undefined",
  // M2 wave A: serviceability + quote, order lifecycle + returns, the gst
  // module's stored invoice + PDF, settings kill-switch, wishlist.
  "getPincode: the serviceability card",
  "quoteCheckout: the risk card",
  "confirmOrder and advanceOrder ride the simulation",
  "requestReturn on a delivered order",
  "wishlist toggle and read",
  "getStoreConfig: the kill-switch card",
  "invoicePdf: bytes for the key-holder, 404 for anyone else",
]);

/**
 * The public client surface both transports serve. Structural rather than the
 * nominal classes (whose private fields block cross-assignment); withToken is
 * re-typed so a signed-in client is still a ContractClient.
 */
type ContractClient = Omit<
  { [K in keyof SiumoraClient]: SiumoraClient[K] },
  "withToken"
> & { withToken(token: string | undefined): ContractClient };

const OPERATOR_PHONE = "9000000001";
const CUSTOMER_PHONE = "9812345678";

let testDb: TestDatabase | undefined;
let app: App;
let client: ContractClient;

if (!usingFastify) {
  // Loud refusal, not a skip: missing MEDUSA_URL / MEDUSA_PUBLISHABLE_KEY
  // throws here, before a single test can report a vacuous green.
  client = createMedusaClient(process.env);
}

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

/**
 * Register one contract test against the selected transport.
 *
 * fastify: exactly the pre-parametrization behavior — DATABASE_URL-gated,
 * server.inject, every test runs the real body.
 *
 * medusa + name in MEDUSA_PORTED: the real body runs against live Medusa.
 * A not_ported refusal inside it is a plain test FAILURE — no silent skip.
 *
 * medusa + name not in MEDUSA_PORTED: the body must die with NotPortedError
 * (501 not_ported) at its first unported call. Ported prefix work (catalogue
 * reads, cart setup) runs for real first, which proves the refusal sits at
 * the exact method boundary the port will replace.
 */
function contract(name: string, fn: () => void | Promise<void>) {
  if (usingFastify) {
    (url ? test : test.skip)(name, fn);
    return;
  }
  if (MEDUSA_PORTED.has(name)) {
    test(name, fn);
    return;
  }
  test(name, async () => {
    await assert.rejects(
      (async () => {
        await fn();
      })(),
      (error: unknown) => {
        // A body whose own assert.rejects expected a different ApiError (e.g.
        // the 409 illegal_transition arm) surfaces the refusal wrapped in an
        // AssertionError with the original on .actual — still the refusal.
        const refusal =
          error instanceof NotPortedError
            ? error
            : error instanceof assert.AssertionError &&
                (error as { actual?: unknown }).actual instanceof NotPortedError
              ? ((error as { actual?: unknown }).actual as NotPortedError)
              : undefined;
        assert.ok(
          refusal,
          `${name}: expected NotPortedError from the medusa transport, got: ${String(error)}`,
        );
        assert.equal(refusal.status, 501, `${name}: not_ported must be a 501`);
        assert.equal(refusal.code, "not_ported", `${name}: wrong refusal code`);
        return true;
      },
      `${name}: the medusa transport served this without a refusal — ` +
        "if the port landed, move the test into MEDUSA_PORTED so it asserts real shapes",
    );
  });
}

before(async () => {
  if (!usingFastify || !url) return;
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
  if (!usingFastify || !url) return;
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

/**
 * Sign in via OTP — real on both transports since the phone-OTP provider
 * ported. Tests whose deeper methods are still unported refuse AFTER the
 * sign-in, at the exact boundary the port will replace.
 */
async function signedInClient(phone: string) {
  const actual = testPhone(phone);
  const issued = await client.requestOtp(actual);
  const verified = await client.verifyOtp(actual, issued.code!);
  return { client: client.withToken(verified.token), verified };
}

/**
 * The phone a sign-in flow uses. Fastify keeps the fixed numbers — its DB
 * truncates between tests and adminPhones pins the operator. Medusa shares
 * one live instance across the whole run, where the provider's own 45-second
 * resend cooldown is per number — a fresh number per sign-in keeps the
 * anti-abuse contract from failing the suite that ports it.
 */
function testPhone(base: string): string {
  if (usingFastify) return base;
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
}

/** Anonymous cart setup — works on both transports. */
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

contract("requestOtp: envelope, and the echo-mode code", async () => {
  const issued = await client.requestOtp(testPhone(CUSTOMER_PHONE));
  assertExactKeys(issued, ["ok", "maskedPhone", "expiresAt", "delivery", "code"], "requestOtp");
  assert.equal(issued.ok, true);
  assert.match(issued.code!, /^\d{6}$/);
  assert.ok(["sent", "not_configured"].includes(issued.delivery));
});

contract("verifyOtp: token, admin flag, and the customer card", async () => {
  const phone = testPhone(CUSTOMER_PHONE);
  const issued = await client.requestOtp(phone);
  const verified = await client.verifyOtp(phone, issued.code!);
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

contract("getSession: both arms of the union", async () => {
  const anonymous = await client.getSession();
  assert.deepEqual(anonymous, { signedIn: false });

  const { client: signed } = await signedInClient(CUSTOMER_PHONE);
  const session = await signed.getSession();
  assertExactKeys(session, ["signedIn", "isAdmin", "customer"], "getSession");
});

contract("signOut, signOutEverywhere, updateProfile", async () => {
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

contract("listProducts: every product validates against core's schema", async () => {
  const products = await client.listProducts();
  assert.ok(products.length > 0);
  for (const product of products) {
    const parsed = productSchema.safeParse(product);
    assert.ok(parsed.success, `product ${product.handle} broke the core schema`);
  }
  const searched = await client.listProducts({ q: "stud" });
  assert.ok(Array.isArray(searched));
});

contract("getProduct: full card, and undefined on a stale link", async () => {
  const products = await client.listProducts();
  const card = await client.getProduct(products[0]!.handle);
  assertExactKeys(card, ["product", "reviews", "rating"], "getProduct");
  assert.ok(productSchema.safeParse(card!.product).success);
  assert.ok(Array.isArray(card!.reviews));

  assert.equal(await client.getProduct("does-not-exist"), undefined);
});

contract("listCollections validates against core's schema", async () => {
  const collections = await client.listCollections();
  assert.ok(collections.length > 0);
  for (const collection of collections) {
    assert.ok(collectionSchema.safeParse(collection).success, collection.handle);
  }
});

contract("getPincode: the serviceability card", async () => {
  const pin = await client.getPincode("400001");
  assertExactKeys(
    pin,
    ["pincode", "city", "stateCode", "serviceable", "codAvailable", "estimatedDays", "rtoRateBps"],
    "getPincode",
  );
  assert.equal(pin.serviceable, true);
});

// ── Cart ──────────────────────────────────────────────────────

contract("cart lifecycle: create, add, read, requantify, clear", async () => {
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

contract("quoteCheckout: the risk card", async () => {
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

contract("checkout: COD envelope, order number format, access key", async () => {
  const { placed } = await placeCodOrder();
  assertExactKeys(
    placed,
    ["ok", "orderNumber", "status", "invoiceNumber", "accessKey"],
    "checkout (cod)",
  );
  assert.match(placed.orderNumber, /^SIU-\d{5}$/);
  assert.ok(placed.accessKey.length >= 16);
});

contract("checkout: the same idempotency key returns the same order", async () => {
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

contract("getOrder: guest key gets the card, no key gets undefined", async () => {
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

contract("listOrders: the signed-in customer's own orders", async () => {
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

contract("confirmOrder and advanceOrder ride the simulation", async () => {
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

contract("requestReturn on a delivered order", async () => {
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

contract("wishlist toggle and read", async () => {
  const products = await client.listProducts();
  const wishlistId = crypto.randomUUID();

  const toggled = await client.toggleWishlist(wishlistId, products[0]!.handle);
  assertExactKeys(toggled, ["wishlisted", "count"], "toggleWishlist");
  assert.equal(toggled.wishlisted, true);

  const handles = await client.getWishlist(wishlistId);
  assert.deepEqual(handles, [products[0]!.handle]);
});

// ── Data-principal rights ─────────────────────────────────────

contract("exportMyData and requestErasure", async () => {
  const { client: signed } = await signedInClient(CUSTOMER_PHONE);

  const data = await signed.exportMyData();
  assert.ok(data && typeof data === "object");

  const erasure = await signed.requestErasure();
  assert.ok("requestId" in erasure && "erased" in erasure && "retained" in erasure);
  assert.ok(Array.isArray(erasure.retained));
});

// ── Admin ─────────────────────────────────────────────────────

contract("admin reads: metrics, audit, remittances, gstr1", async () => {
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

contract("getStoreConfig: the kill-switch card", async () => {
  const config = await client.getStoreConfig();
  assertExactKeys(config, ["paymentsEnabled", "razorpayConfigured"], "getStoreConfig");
  assert.equal(typeof config.paymentsEnabled, "boolean");
});

// ── Invoice PDF ───────────────────────────────────────────────

contract("invoicePdf: bytes for the key-holder, 404 for anyone else", async () => {
  const { placed } = await placeCodOrder();

  const pdf = await client.invoicePdf(placed.orderNumber, placed.accessKey);
  assert.equal(pdf.ok, true);
  const magic = new TextDecoder().decode(new Uint8Array(pdf.body!).slice(0, 5));
  assert.equal(magic, "%PDF-");

  const refused = await client.invoicePdf(placed.orderNumber);
  assert.deepEqual(refused, { ok: false, status: 404 });
});

// ── Error contract and construction ───────────────────────────

contract("errors arrive as ApiError with a structured code", async () => {
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

contract("withToken returns a new client; the original stays anonymous", async () => {
  const { verified } = await signedInClient(CUSTOMER_PHONE);
  const signed = client.withToken(verified.token);
  const before = await client.getSession();
  assert.deepEqual(before, { signedIn: false });
  const after = await signed.getSession();
  assert.equal(after.signedIn, true);
});

contract("createClient: refuses a missing base URL, honors API_URL", () => {
  if (!usingFastify) {
    // The medusa mirror of the same construction contract: refuse a missing
    // configuration rather than defaulting to a machine that is not there.
    assert.throws(() => createMedusaClient({}), /MEDUSA_URL/);
    assert.ok(
      createMedusaClient({
        MEDUSA_URL: "http://example.test",
        MEDUSA_PUBLISHABLE_KEY: "pk_test",
      }) instanceof MedusaClient,
    );
    return;
  }
  assert.throws(() => createClient({}), /API_URL/);
  assert.ok(createClient({ API_URL: "http://example.test" }) instanceof SiumoraClient);
});
