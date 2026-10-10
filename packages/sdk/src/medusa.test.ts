import assert from "node:assert/strict";
import { test } from "node:test";

import { calculateTotals, productSchema } from "@siumora/core";

import { ApiError } from "./index.ts";
import {
  MedusaClient,
  NotPortedError,
  createMedusaClient,
  majorToPaise,
  mapCartLine,
  mapCollection,
  mapProduct,
} from "./medusa.ts";

/**
 * Two layers, mirroring the transport's two risks.
 *
 * The mapping layer is tested on recorded fixtures — verbatim captures of a
 * live Medusa 2.18 store response — because that is where every cutover bug
 * will live. The transport layer is tested against a live Medusa when
 * MEDUSA_URL and MEDUSA_PUBLISHABLE_KEY are set, and skips cleanly when not:
 * the same convention as the DATABASE_URL-gated suites.
 */

// ── Recorded fixtures (live capture, 2026-07-31) ──────────────────────────

const PRODUCT_FIXTURE = {
  id: "prod_01KYVRRM4N3K8AA0MXJHFF44K3",
  handle: "petal-studs",
  title: "Petal Studs",
  subtitle: "The four-circle mark, worn small.",
  description:
    "925 sterling silver with 18k gold PVD. Hypoallergenic, nickel-free.",
  metadata: {
    hsn: "7113",
    gst_slab: 5,
    material: "925 sterling silver · 18k gold PVD",
    collections: ["everyday", "gifting"],
    pierced_jewellery: true,
  },
  images: [
    {
      url: "/catalog/petal-studs.svg",
      metadata: { alt: "Petal Studs", width: 1200, height: 1500 },
    },
  ],
  variants: [
    {
      id: "variant_01KYVRRMBXWR9G30WX1JKY74QA",
      sku: "SIU-PS-GLD",
      title: "Gold",
      metadata: { mrp_paise: 249000, price_paise: 199000 },
      inventory_quantity: 24,
      calculated_price: { calculated_amount: 1990 },
    },
    {
      id: "variant_01KYVRRMBXWR9G30WX1JKY74QB",
      sku: "SIU-PS-SLV",
      title: "Silver",
      metadata: { mrp_paise: 229000, price_paise: 189000 },
      inventory_quantity: 11,
      calculated_price: { calculated_amount: 1890 },
    },
  ],
};

const CART_ITEM_FIXTURE = {
  id: "item_01KYVSEE0M8Q2W7Q0F3T1R9XAB",
  quantity: 2,
  unit_price: 1990,
  variant_id: "variant_01KYVRRMBXWR9G30WX1JKY74QA",
  variant_sku: "SIU-PS-GLD",
  variant_title: "Gold",
  product_title: "Petal Studs",
  product_handle: "petal-studs",
  thumbnail: "/catalog/petal-studs.svg",
  variant: {
    id: "variant_01KYVRRMBXWR9G30WX1JKY74QA",
    sku: "SIU-PS-GLD",
    title: "Gold",
    metadata: { mrp_paise: 249000, price_paise: 199000 },
    product: {
      metadata: {
        hsn: "7113",
        gst_slab: 5,
        material: "925 sterling silver · 18k gold PVD",
        collections: ["everyday", "gifting"],
        pierced_jewellery: true,
      },
      images: [{ url: "/catalog/petal-studs.svg", metadata: { alt: "Petal Studs" } }],
    },
  },
};

// ── Money ─────────────────────────────────────────────────────────────────

test("majorToPaise: exact integers only", () => {
  assert.equal(majorToPaise(1990), 199000);
  assert.equal(majorToPaise(19.9), 1990);
  assert.equal(majorToPaise(0), 0);
  // Sub-paise amounts mean a float got into the pipeline — refuse them.
  assert.throws(() => majorToPaise(19.901));
  assert.throws(() => majorToPaise(Number.NaN));
});

// ── Mapping ───────────────────────────────────────────────────────────────

test("mapProduct: the fixture lands as a schema-valid core Product", () => {
  const product = mapProduct(PRODUCT_FIXTURE);
  assert.ok(productSchema.safeParse(product).success);
  assert.equal(product.handle, "petal-studs");
  assert.equal(product.hsn, "7113");
  assert.equal(product.gstSlab, 5);
  assert.equal(product.piercedJewellery, true);
  assert.deepEqual(product.collections, ["everyday", "gifting"]);
  // Paise come from metadata, lossless — never through the ×100 fallback.
  assert.deepEqual(product.variants[0]!.price, { mrp: 249000, selling: 199000 });
  assert.equal(product.variants[0]!.inventory, 24);
  assert.equal(product.images[0]!.width, 1200);
});

test("mapProduct: falls back to calculated_price × 100 when metadata is absent", () => {
  const stripped = structuredClone(PRODUCT_FIXTURE);
  stripped.variants[0]!.metadata = {} as (typeof stripped.variants)[0]["metadata"];
  const product = mapProduct(stripped);
  // MRP collapses to selling when the lossless channel is gone.
  assert.deepEqual(product.variants[0]!.price, { mrp: 199000, selling: 199000 });
});

test("mapProduct: a product without a gst_slab is a loud error, not a guess", () => {
  const broken = structuredClone(PRODUCT_FIXTURE);
  broken.metadata = { ...broken.metadata, gst_slab: undefined } as never;
  assert.throws(() => mapProduct(broken), /gst_slab/);
});

test("mapCollection: description rides metadata", () => {
  const collection = mapCollection({
    id: "pcol_01",
    handle: "everyday",
    title: "Everyday",
    metadata: { description: "Pieces for every day." },
  });
  assert.equal(collection.description, "Pieces for every day.");
});

test("mapCartLine: paise, slab and hygiene flag survive the trip", () => {
  const line = mapCartLine(CART_ITEM_FIXTURE);
  assert.equal(line.variantId, "variant_01KYVRRMBXWR9G30WX1JKY74QA");
  assert.equal(line.sku, "SIU-PS-GLD");
  assert.equal(line.productHandle, "petal-studs");
  assert.equal(line.unitPrice, 199000);
  assert.equal(line.mrp, 249000);
  assert.equal(line.gstSlab, 5);
  assert.equal(line.hsn, "7113");
  assert.equal(line.piercedJewellery, true);

  // The same totals engine the Fastify cart read runs, over the mapped line:
  // 2 × ₹1,990 = ₹3,980 ≥ the free-shipping threshold, tax extracted at 5%.
  const totals = calculateTotals([line], { interState: false, shipping: 0 });
  assert.equal(totals.subtotal, 398000);
  assert.equal(totals.mrpTotal, 498000);
  assert.equal(totals.savings, 100000);
  assert.equal(totals.itemCount, 2);
  assert.equal(totals.gst.totalTax, totals.gst.cgst + totals.gst.sgst);
});

// ── Construction ──────────────────────────────────────────────────────────

test("createMedusaClient: refuses missing configuration by name", () => {
  assert.throws(() => createMedusaClient({}), /MEDUSA_URL and MEDUSA_PUBLISHABLE_KEY/);
  assert.ok(
    createMedusaClient({
      MEDUSA_URL: "http://example.test",
      MEDUSA_PUBLISHABLE_KEY: "pk_x",
    }) instanceof MedusaClient,
  );
});

test("updateProfile writes the authenticated Medusa customer and maps the result", async () => {
  let request: { url: string; init: RequestInit } | undefined;
  const client = new MedusaClient({
    baseUrl: "http://example.test",
    publishableKey: "pk_x",
    token: "session-token",
    fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
      request = { url: String(url), init: init ?? {} };
      return Response.json({
        customer: {
          id: "cus_1",
          phone: "9812345678",
          first_name: "Asha",
          last_name: "Rao Singh",
          email: "asha@example.com",
        },
      });
    }) as typeof fetch,
  });

  const result = await client.updateProfile({
    name: "  Asha   Rao Singh  ",
    email: " asha@example.com ",
  });
  assert.equal(request?.url, "http://example.test/store/customers/me");
  assert.equal(request?.init.method, "POST");
  assert.equal(
    new Headers(request?.init.headers).get("authorization"),
    "Bearer session-token",
  );
  assert.deepEqual(JSON.parse(String(request?.init.body)), {
    first_name: "Asha",
    last_name: "Rao Singh",
    email: "asha@example.com",
  });
  assert.equal(result.ok, true);
  assert.equal(result.customer.name, "Asha Rao Singh");
  assert.equal(result.customer.email, "asha@example.com");
});

test("limited catalogue read requests only the home rail from Medusa", async () => {
  const paths: string[] = [];
  const client = new MedusaClient({
    baseUrl: "http://example.test",
    publishableKey: "pk_x",
    fetch: (async (url: URL | RequestInfo) => {
      const path = String(url);
      paths.push(path);
      if (path.endsWith("/store/regions")) {
        return Response.json({ regions: [{ id: "reg_in", currency_code: "inr" }] });
      }
      return Response.json({ products: [PRODUCT_FIXTURE] });
    }) as typeof fetch,
  });

  const products = await client.listProducts({ limit: 8 });
  assert.equal(products.length, 1);
  assert.equal(products[0]?.handle, "petal-studs");
  assert.match(paths[1] ?? "", /[?&]limit=8(?:&|$)/);
  assert.match(paths[1] ?? "", /[?&]order=-created_at(?:&|$)/);
});

test("removeWishlist uses the idempotent Medusa item route", async () => {
  let request: { url: string; method?: string } | undefined;
  const client = new MedusaClient({
    baseUrl: "http://example.test",
    publishableKey: "pk_x",
    fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
      request = { url: String(url), method: init?.method };
      return Response.json({ count: 0 });
    }) as typeof fetch,
  });

  assert.deepEqual(
    await client.removeWishlist("list_1", "petal-studs"),
    { count: 0 },
  );
  assert.equal(request?.method, "DELETE");
  assert.equal(
    request?.url,
    "http://example.test/store/siumora/wishlists/list_1/items/petal-studs",
  );
});

test("not-yet-ported surface refuses with 501 not_ported, never a wrong answer", async () => {
  const client = new MedusaClient({ baseUrl: "http://x", publishableKey: "pk" });
  // Prepaid checkout refuses too — only the COD path is ported.
  await assert.rejects(
    client.checkout({
      cartId: "cart_x",
      address: {
        name: "A",
        phone: "9812345678",
        line1: "x",
        city: "Mumbai",
        stateCode: "27",
        pincode: "400001",
      },
      paymentMethod: "upi",
      eventId: "e",
    }),
    (error: unknown) => {
      assert.ok(error instanceof NotPortedError);
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 501);
      assert.equal(error.code, "not_ported");
      return true;
    },
  );
});

// ── Live transport (needs a running Medusa + seed) ────────────────────────

const liveUrl = process.env.MEDUSA_URL;
const liveKey = process.env.MEDUSA_PUBLISHABLE_KEY;
const liveTest = liveUrl && liveKey ? test : test.skip;

function liveClient(): MedusaClient {
  return new MedusaClient({ baseUrl: liveUrl!, publishableKey: liveKey! });
}

liveTest("live: listProducts serves the seeded catalogue, schema-valid", async () => {
  const products = await liveClient().listProducts();
  assert.equal(products.length, 4);
  for (const product of products) {
    assert.ok(productSchema.safeParse(product).success, product.handle);
  }
});

liveTest("live: collection filter uses full membership, not just the primary", async () => {
  const gifting = await liveClient().listProducts({ collection: "gifting" });
  assert.ok(gifting.some((product) => product.handle === "petal-studs"));
});

liveTest("live: search rides core's scorer", async () => {
  const hits = await liveClient().listProducts({ q: "studs" });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0]!.handle, "petal-studs");
});

liveTest("live: getProduct full card, and undefined on a stale link", async () => {
  const card = await liveClient().getProduct("petal-studs");
  assert.ok(card);
  assert.deepEqual(Object.keys(card).sort(), ["product", "rating", "reviews"]);
  assert.equal(await liveClient().getProduct("does-not-exist"), undefined);
});

liveTest("live: listCollections", async () => {
  const collections = await liveClient().listCollections();
  assert.equal(collections.length, 3);
});

liveTest("live: cart lifecycle with Fastify-shaped envelopes", async () => {
  const client = liveClient();
  const cartId = await client.createCart();
  const products = await client.listProducts();
  const variant = products[0]!.variants[0]!;

  const added = await client.addToCart(cartId, variant.id, 2);
  assert.deepEqual(Object.keys(added).sort(), ["count", "ok"]);
  assert.equal(added.count, 2);

  const cart = await client.getCart(cartId);
  assert.deepEqual(Object.keys(cart).sort(), ["cartId", "lines", "totals"]);
  assert.deepEqual(
    Object.keys(cart.totals).sort(),
    ["codFee", "gst", "itemCount", "mrpTotal", "savings", "shipping", "subtotal", "total"],
  );
  assert.equal(cart.totals.itemCount, 2);
  assert.equal(cart.lines[0]!.unitPrice, variant.price.selling);

  const requantified = await client.setCartQuantity(cartId, variant.id, 1);
  assert.equal(requantified.count, 1);

  await client.clearCart(cartId);
  const cleared = await client.getCart(cartId);
  assert.equal(cleared.lines.length, 0);
  assert.equal(cleared.totals.itemCount, 0);
});

liveTest("live: refuses to add more than the stock on hand", async () => {
  const client = liveClient();
  const cartId = await client.createCart();
  const products = await client.listProducts();
  const variant = products[0]!.variants[0]!;
  await assert.rejects(
    client.addToCart(cartId, variant.id, variant.inventory + 1),
    (error: unknown) =>
      error instanceof ApiError && error.status === 409 && error.code === "unavailable",
  );
});

liveTest("live: an unknown variant is refused, structured", async () => {
  const client = liveClient();
  const cartId = await client.createCart();
  await assert.rejects(
    client.addToCart(cartId, "variant_does_not_exist"),
    (error: unknown) =>
      error instanceof ApiError && error.status === 409 && error.code === "unavailable",
  );
});

// ── Sessions (auth plan phase 1) ──────────────────────────────────────────

function scripted(answers: Record<string, unknown>) {
  const calls: Array<{ method: string; url: string; body: unknown; auth: string | undefined }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({
      method: String(init.method),
      url: String(url),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      auth: headers.authorization,
    });
    const key = `${init.method} ${new URL(String(url)).pathname}`;
    const body = answers[key];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({ error: "not_found" }) };
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("sign-in is one call to the verify route, and the session token is what comes back", async () => {
  const envelope = {
    ok: true,
    token: "sst_" + "a".repeat(43),
    expiresAt: "2026-11-09T00:00:00.000Z",
    isAdmin: false,
    claimedOrders: 0,
    customer: { id: "cus_1", phone: "9812345678", maskedPhone: "98••••5678", name: "", email: null },
  };
  const { impl, calls } = scripted({ "POST /store/siumora-auth/verify": envelope });
  const client = new MedusaClient({ baseUrl: "http://m", publishableKey: "pk", fetch: impl });
  assert.deepEqual(await client.verifyOtp("98123 45678", "123456"), envelope);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.body, { phone: "98123 45678", code: "123456" });
});

test("a code request carries the channel and the challenge token only when given", async () => {
  const issued = { ok: true, maskedPhone: "98••••5678", expiresAt: "x", delivery: "sent", channel: "sms", channels: ["whatsapp", "sms"] };
  const { impl, calls } = scripted({ "POST /store/siumora-auth/otp": issued });
  const client = new MedusaClient({ baseUrl: "http://m", publishableKey: "pk", fetch: impl });
  await client.requestOtp("9812345678");
  await client.requestOtp("9812345678", { channel: "sms", turnstileToken: "tt" });
  assert.deepEqual(calls[0]!.body, { phone: "9812345678" });
  assert.deepEqual(calls[1]!.body, { phone: "9812345678", channel: "sms", turnstileToken: "tt" });
});

test("session reads, sign-out and device revocation ride the session bearer", async () => {
  const token = "sst_" + "b".repeat(43);
  const { impl, calls } = scripted({
    "GET /store/siumora-auth/session": { signedIn: false },
    "POST /store/siumora-auth/signout": { ok: true },
    "POST /store/siumora-auth/signout-everywhere": { ok: true, revoked: 3 },
    "GET /store/siumora-auth/sessions": { sessions: [] },
    "DELETE /store/siumora-auth/sessions/sises_1": { ok: true, current: false },
    "POST /store/siumora-auth/step-up": { ok: true, stepUpExpiresAt: "x" },
  });
  const anonymous = new MedusaClient({ baseUrl: "http://m", publishableKey: "pk", fetch: impl });
  assert.deepEqual(await anonymous.getSession(), { signedIn: false });
  assert.equal(calls.length, 0, "no token, no call");

  const client = anonymous.withToken(token);
  assert.deepEqual(await client.getSession(), { signedIn: false });
  await client.signOut();
  assert.deepEqual(await client.signOutEverywhere(), { ok: true, revoked: 3 });
  assert.deepEqual(await client.listSessions(), []);
  assert.deepEqual(await client.revokeSession("sises_1"), { ok: true, current: false });
  assert.equal((await client.stepUp("123456")).ok, true);
  assert.ok(calls.every((call) => call.auth === `Bearer ${token}`));
});

test("the account surfaces call their routes and map the address book", async () => {
  const token = "sst_" + "c".repeat(43);
  const { impl, calls } = scripted({
    "GET /store/siumora/me/orders": { orders: [{ number: "SIU-00001" }] },
    "GET /store/siumora/me/claimable-orders": { orders: [{ number: "SIU-00002", placedAt: "x", itemCount: 1, total: 100, city: "Pune" }] },
    "POST /store/siumora/me/claim": { ok: true, claimed: 1 },
    "POST /store/siumora/me/wishlist": { wishlistId: "11111111-1111-4111-8111-111111111111" },
    "POST /store/siumora/me/cart": { cartId: "cart_01ABCDEFGHIJKLMNOPQRSTUVWX" },
    "GET /store/siumora/me/data": { customer: { id: "cus_1" } },
    "POST /store/siumora/me/erasure": { requestId: "sipr_1", alreadyOpen: false, erased: true, resolveBy: "x", retained: [] },
    "POST /store/siumora-auth/phone": { ok: true, maskedPhone: "98••••0000", signedOutDevices: 2 },
    "GET /store/customers/me/addresses": {
      addresses: [{
        id: "cuaddr_1", first_name: "Asha", last_name: "Rao", phone: "9812345678",
        address_1: "4B Rose Villa", address_2: null, city: "Pune", province: "27",
        postal_code: "411001", is_default_shipping: true,
      }],
    },
  });
  const client = new MedusaClient({ baseUrl: "http://m", publishableKey: "pk", fetch: impl }).withToken(token);

  assert.deepEqual(await client.listOrders(), [{ number: "SIU-00001" }]);
  assert.equal((await client.listClaimableOrders())[0]!.city, "Pune");
  assert.deepEqual(await client.claimOrders(["SIU-00002"]), { ok: true, claimed: 1 });
  assert.equal((await client.linkWishlist()).wishlistId, "11111111-1111-4111-8111-111111111111");
  assert.equal((await client.linkCart("cart_01ABCDEFGHIJKLMNOPQRSTUVWX")).cartId, "cart_01ABCDEFGHIJKLMNOPQRSTUVWX");
  assert.deepEqual(await client.exportMyData(), { customer: { id: "cus_1" } });
  assert.equal((await client.requestErasure()).erased, true);
  assert.equal((await client.changePhone("9800000000", "123456")).signedOutDevices, 2);
  assert.deepEqual(await client.listAddresses(), [{
    id: "cuaddr_1", name: "Asha Rao", phone: "9812345678", line1: "4B Rose Villa",
    city: "Pune", stateCode: "27", pincode: "411001", isDefault: true,
  }]);

  const claim = calls.find((call) => call.url.endsWith("/me/claim"));
  assert.deepEqual(claim?.body, { numbers: ["SIU-00002"] });
  const wishlist = calls.find((call) => call.url.endsWith("/me/wishlist"));
  assert.deepEqual(wishlist?.body, {}, "no browser list, nothing sent");
});
