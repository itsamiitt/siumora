import assert from "node:assert/strict";
import { DEFAULT_STOREFRONT } from "@siumora/core/storefront";
import { test } from "node:test";

test("storefront content uses the backend, short revalidation, and rejects malformed payloads", async () => {
  let content: unknown = { ...DEFAULT_STOREFRONT, title: "Published in admin" };
  const client = new MedusaClient({ baseUrl: "https://example.test", publishableKey: "pk_test", fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
    assert.equal(String(url), "https://example.test/store/siumora/storefront");
    assert.equal((init as RequestInit & { next: { revalidate: number } }).next.revalidate, 5);
    return Response.json({ content });
  }) as typeof fetch });
  assert.equal((await client.getStorefrontContent()).title, "Published in admin");
  content = { ...DEFAULT_STOREFRONT, buttonHref: "javascript:alert(1)" };
  await assert.rejects(client.getStorefrontContent(), /Invalid storefront/);
});

import { calculateTotals, productSchema } from "@siumora/core";

import { ApiError } from "./index.ts";
import {
  MedusaClient,
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
  collection: { id: "pcol_everyday", handle: "everyday" },
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
  assert.deepEqual(product.collections, ["everyday"]);
  // Native contextual prices are converted to integer paise.
  assert.deepEqual(product.variants[0]!.price, { mrp: 249000, selling: 199000 });
  assert.equal(product.variants[0]!.inventory, 24);
  assert.equal(product.images[0]!.width, 1200);
});

test("mapProduct: uses calculated_price with no price metadata", () => {
  const stripped = structuredClone(PRODUCT_FIXTURE);
  stripped.variants[0]!.metadata = {} as (typeof stripped.variants)[0]["metadata"];
  const product = mapProduct(stripped);
  // MRP collapses to selling when the lossless channel is gone.
  assert.deepEqual(product.variants[0]!.price, { mrp: 199000, selling: 199000 });
});

test("native price edits win over stale selling metadata", () => {
  const edited = structuredClone(PRODUCT_FIXTURE);
  edited.variants[0]!.calculated_price.calculated_amount = 1790.50;
  assert.deepEqual(mapProduct(edited).variants[0]!.price, {
    mrp: 249000, selling: 179050,
  });
});

test("missing contextual price cannot silently fall back to stale metadata", () => {
  const broken = structuredClone(PRODUCT_FIXTURE);
  broken.variants[0]!.calculated_price = { calculated_amount: null } as never;
  assert.throws(() => mapProduct(broken), /no usable price/);
});

test("cart line price wins over stale variant metadata and later catalog changes", () => {
  const item = structuredClone(CART_ITEM_FIXTURE);
  item.unit_price = 1790.50;
  item.variant.metadata.price_paise = 229000;
  const line = mapCartLine(item);
  assert.equal(line.unitPrice, 179050);
  assert.equal(calculateTotals([line], { interState: false, shipping: 0 }).subtotal, 358100);
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

test("native thumbnail and material edits override old gallery order and seed metadata", () => {
  const product = mapProduct({ ...PRODUCT_FIXTURE, thumbnail: "/uploads/new-photo.webp", material: "Gold vermeil",
    images: [...PRODUCT_FIXTURE.images, { url: "/uploads/new-photo.webp", metadata: { alt: "New photo", width: 800, height: 1000 } }],
  });
  assert.equal(product.material, "Gold vermeil");
  assert.equal(product.images[0]!.url, "/uploads/new-photo.webp");
  assert.equal(product.images[0]!.alt, "New photo");
  assert.equal(product.images.length, 2);
  assert.equal(mapProduct({ ...PRODUCT_FIXTURE, material: "" }).material, "");
});

test("a thumbnail-only product retains its backend image", () => {
  const product = mapProduct({ ...PRODUCT_FIXTURE, images: [], thumbnail: "/uploads/only-photo.webp" });
  assert.equal(product.images[0]!.url, "/uploads/only-photo.webp");
});

test("removing native collection membership does not resurrect stale seed metadata", () => {
  const product = { ...PRODUCT_FIXTURE, collection: null };
  assert.deepEqual(mapProduct(product).collections, []);
});

test("catalog reads all pages and filters categories by backend ID, not product title", async () => {
  const offsets: number[] = [];
  const client = new MedusaClient({ baseUrl: "http://example.test", publishableKey: "pk_test",
    fetch: (async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname === "/store/regions") return Response.json({ regions: [{ id: "in", currency_code: "inr" }] });
      assert.equal(url.searchParams.get("category_id[]"), "pcat_bracelets");
      assert.ok(url.searchParams.get("fields")?.includes("*collection"));
      const offset = Number(url.searchParams.get("offset"));
      offsets.push(offset);
      const size = offset === 0 ? 100 : 1;
      return Response.json({ count: 101, products: Array.from({ length: size }, (_, i) => ({
        ...PRODUCT_FIXTURE, id: `product_${offset + i}`, title: "A name with no category keyword",
      })) });
    }) as typeof fetch,
  });
  assert.equal((await client.listProductsInCategory("pcat_bracelets")).length, 101);
  assert.deepEqual(offsets, [0, 100]);
});

test("collection filtering uses the current native collection ID", async () => {
  const client = new MedusaClient({ baseUrl: "http://example.test", publishableKey: "pk_test",
    fetch: (async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname === "/store/regions") return Response.json({ regions: [{ id: "in", currency_code: "inr" }] });
      if (url.pathname === "/store/collections") return Response.json({ count: 1,
        collections: [{ id: "pcol_new", handle: "new-edit", title: "New edit" }],
      });
      assert.equal(url.searchParams.get("collection_id[]"), "pcol_new");
      return Response.json({ count: 1, products: [{ ...PRODUCT_FIXTURE,
        collection: { id: "pcol_new", handle: "new-edit" },
      }] });
    }) as typeof fetch,
  });
  const products = await client.listProducts({ collection: "new-edit" });
  assert.deepEqual(products[0]!.collections, ["new-edit"]);
  assert.deepEqual(await client.listProducts({ collection: "deleted-edit" }), []);
});

test("category and collection lists follow server pagination even with a smaller page cap", async () => {
  const client = new MedusaClient({ baseUrl: "http://example.test", publishableKey: "pk_test",
    fetch: (async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      const offset = Number(url.searchParams.get("offset"));
      const item = { id: `id_${offset}`, name: `Category ${offset}`, title: `Collection ${offset}`, handle: `handle-${offset}`, parent_category_id: null };
      return Response.json({ count: 2, [url.pathname === "/store/product-categories" ? "product_categories" : "collections"]: [item] });
    }) as typeof fetch,
  });
  assert.deepEqual((await client.listCategories()).map(c => c.name), ["Category 0", "Category 1"]);
  assert.deepEqual((await client.listCollections()).map(c => c.title), ["Collection 0", "Collection 1"]);
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
  // Names only: Medusa's profile route takes nothing else, and an
  // unchanged email is not sent anywhere.
  assert.deepEqual(JSON.parse(String(request?.init.body)), {
    first_name: "Asha",
    last_name: "Rao Singh",
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

test("prepaid checkout() is refused — payment comes first on this backend", async () => {
  const client = new MedusaClient({ baseUrl: "http://x", publishableKey: "pk" });
  // Placing an unpaid prepaid order is exactly what payment-first prevents.
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
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "payment_first");
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

liveTest("live: collection filter follows native collection assignment", async () => {
  const gifting = await liveClient().listProducts({ collection: "gifting" });
  const all = await liveClient().listProducts();
  assert.deepEqual(gifting.map(p => p.id).sort(), all.filter(p => p.collections.includes("gifting")).map(p => p.id).sort());
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

test("Google: start, then callback and hand-off with the Google token as bearer", async () => {
  const googleJwt = "eyJ.google.jwt";
  const { impl, calls } = scripted({
    "POST /auth/customer/google": { location: "https://accounts.google.com/o/oauth2/v2/auth?x=1" },
    "POST /auth/customer/google/callback": { token: googleJwt },
    "POST /store/siumora-auth/google": { ok: true, needsPhone: true, linkToken: "lt" },
    "GET /store/siumora-auth/methods": { phone: true, google: true, googlePercent: 50 },
  });
  const client = new MedusaClient({ baseUrl: "http://m", publishableKey: "pk", fetch: impl });
  assert.match((await client.googleStart()).location, /accounts\.google\.com/);
  assert.deepEqual(await client.googleFinish({ code: "c 1", state: "s" }), { ok: true, needsPhone: true, linkToken: "lt" });
  assert.deepEqual(await client.getSignInMethods(), { phone: true, google: true, googlePercent: 50 });

  const callback = calls.find((call) => call.url.includes("/google/callback"));
  assert.match(callback!.url, /code=c\+1&state=s/);
  const handoff = calls.find((call) => call.url.endsWith("/store/siumora-auth/google"));
  assert.equal(handoff!.auth, `Bearer ${googleJwt}`);
});

test("a pending Google link rides the phone verify", async () => {
  const { impl, calls } = scripted({ "POST /store/siumora-auth/verify": { ok: true } });
  const client = new MedusaClient({ baseUrl: "http://m", publishableKey: "pk", fetch: impl });
  await client.verifyOtp("9812345678", "123456", { googleLinkToken: "lt" });
  assert.deepEqual(calls[0]!.body, { phone: "9812345678", code: "123456", googleLinkToken: "lt" });
});

test("a changed email goes through the step-up route, never Medusa's profile route", async () => {
  const { impl, calls } = scripted({
    "POST /store/customers/me": { customer: { id: "cus_1", phone: "9812345678", first_name: "Asha", last_name: "", email: "9812345678@guest.siumora.in" } },
    "POST /store/siumora/me/email": { ok: true, customer: { id: "cus_1", phone: "9812345678", maskedPhone: "98••••5678", name: "Asha", email: "asha@example.com" } },
  });
  const client = new MedusaClient({ baseUrl: "http://m", publishableKey: "pk", fetch: impl }).withToken("sst_" + "d".repeat(43));
  const result = await client.updateProfile({ name: "Asha", email: "asha@example.com" });
  assert.equal(result.customer.email, "asha@example.com");
  assert.ok(!(calls[0]!.body as Record<string, unknown>).email, "no email on the profile route");
  assert.deepEqual(calls[1]!.body, { email: "asha@example.com" });
});

// ── Plan 16 Phase A: availability on lines, field errors, the method ──────

test("cart lines carry units on hand, from one read of just the cart's products", async () => {
  const { impl, calls } = scripted({
    "GET /store/carts/cart_1": {
      cart: { id: "cart_1", items: [{ ...CART_ITEM_FIXTURE, product_id: "prod_1" }] },
    },
    "GET /store/products": {
      products: [{ variants: [{ id: CART_ITEM_FIXTURE.variant.id, inventory_quantity: 3 }] }],
    },
  });
  const client = new MedusaClient({ baseUrl: "http://m", publishableKey: "pk", fetch: impl });
  const { lines } = await client.getCart("cart_1");
  assert.equal(lines[0]!.available, 3);
  const productRead = calls.find((call) => call.url.includes("/store/products"))!;
  assert.match(productRead.url, /id%5B%5D=prod_1|id\[\]=prod_1/);
  assert.match(productRead.url, /limit=1/);
});

test("a failed stock read leaves availability unknown rather than failing the bag", async () => {
  const { impl } = scripted({
    "GET /store/carts/cart_1": {
      cart: { id: "cart_1", items: [{ ...CART_ITEM_FIXTURE, product_id: "prod_1" }] },
    },
  });
  const client = new MedusaClient({ baseUrl: "http://m", publishableKey: "pk", fetch: impl });
  const { lines } = await client.getCart("cart_1");
  assert.equal(lines.length, 1);
  assert.equal("available" in lines[0]!, false);
});

test("a refused address surfaces its field map on the ApiError", async () => {
  const impl = (async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      error: "invalid_address",
      message: "Enter the city.",
      fields: { city: "Enter the city." },
    }),
  })) as unknown as typeof fetch;
  const client = new MedusaClient({ baseUrl: "http://m", publishableKey: "pk", fetch: impl });
  await assert.rejects(client.getPincode("400001"), (error: unknown) => {
    const apiError = error as { code: string; fields?: Record<string, string> };
    assert.equal(apiError.code, "invalid_address");
    assert.deepEqual(apiError.fields, { city: "Enter the city." });
    return true;
  });
});

// ── Plan 16 Phase B: payment-first prepaid ────────────────────────────────

const ADDRESS_INPUT = {
  name: "Asha Menon",
  phone: "98123 45678",
  line1: "Flat 3B, Sunrise Apartments",
  city: "Mumbai",
  stateCode: "27",
  pincode: "400001",
};

test("this transport takes payment first", () => {
  const client = new MedusaClient({ baseUrl: "http://m", publishableKey: "pk" });
  assert.equal(client.paymentFlow, "payment-first");
});

test("preparePayment puts the address on the cart, then opens the payment", async () => {
  const handoff = { razorpay: { orderId: "order_1", keyId: "rzp_test", amountPaise: 225900 } };
  const { impl, calls } = scripted({
    "POST /store/carts/cart_1": { cart: { id: "cart_1" } },
    "POST /store/siumora/carts/cart_1/prepare": handoff,
  });
  const client = new MedusaClient({ baseUrl: "http://m", publishableKey: "pk", fetch: impl });
  assert.deepEqual(
    await client.preparePayment({ cartId: "cart_1", address: ADDRESS_INPUT, paymentMethod: "upi" }),
    handoff,
  );
  assert.deepEqual(
    calls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    ["POST /store/carts/cart_1", "POST /store/siumora/carts/cart_1/prepare"],
  );
  const address = (calls[0]!.body as { shipping_address: Record<string, string> }).shipping_address;
  assert.equal(address.phone, "9812345678", "the phone is normalised on the cart");
  assert.equal(address.province, "27");
  assert.deepEqual(calls[1]!.body, { paymentMethod: "upi" });
});

test("completePayment sends the Checkout.js proof with the method", async () => {
  const placed = {
    ok: true,
    orderNumber: "SIU-00042",
    status: "confirmed",
    invoiceNumber: "SIU/2026-27/000042",
    accessKey: "k".repeat(36),
  };
  const { impl, calls } = scripted({ "POST /store/siumora/carts/cart_1/complete": placed });
  const client = new MedusaClient({ baseUrl: "http://m", publishableKey: "pk", fetch: impl });
  const proof = { orderId: "order_1", paymentId: "pay_1", signature: "sig" };
  assert.deepEqual(
    await client.completePayment({ cartId: "cart_1", paymentMethod: "upi", razorpay: proof }, "key-1"),
    placed,
  );
  assert.deepEqual(calls[0]!.body, { paymentMethod: "upi", razorpay: proof });
});

test("the checkout's event id, GA client id and consent ride the cart's metadata (plan 16 Phase G)", async () => {
  const { impl, calls } = scripted({
    "POST /store/carts/cart_1": { cart: { id: "cart_1" } },
    "POST /store/siumora/carts/cart_1/prepare": { razorpay: { orderId: "o", keyId: "k", amountPaise: 1 } },
  });
  const client = new MedusaClient({ baseUrl: "http://m", publishableKey: "pk", fetch: impl });
  await client.preparePayment({
    cartId: "cart_1",
    address: ADDRESS_INPUT,
    paymentMethod: "upi",
    eventId: "ev_1",
    gaClientId: "123.456",
    consent: "full",
  });
  assert.deepEqual((calls[0]!.body as { metadata: unknown }).metadata, {
    siumora_event_id: "ev_1",
    siumora_ga_client_id: "123.456",
    siumora_consent: "full",
    // Always written, so a removed message does not linger (plan 16 B21).
    siumora_gift_message: "",
  });

  await client.preparePayment({
    cartId: "cart_1",
    address: ADDRESS_INPUT,
    paymentMethod: "upi",
    giftMessage: "  Happy birthday!  ",
  });
  assert.equal((calls[2]!.body as { metadata: Record<string, unknown> }).metadata.siumora_gift_message, "Happy birthday!");
});

test("coupons go through the Siumora route with the cart id and code in the body", async () => {
  const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
  const client = new MedusaClient({
    baseUrl: "https://example.test",
    publishableKey: "pk_test",
    fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ coupons: ["DIWALI10"], discount: 19900 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });
  assert.deepEqual(await client.applyCoupon("cart_1", "diwali10"), { coupons: ["DIWALI10"], discount: 19900 });
  await client.removeCoupon("cart_1", "DIWALI10");
  assert.equal(calls[0]!.url, "https://example.test/store/siumora/coupons");
  assert.equal(calls[0]!.method, "POST");
  assert.deepEqual(calls[0]!.body, { cartId: "cart_1", code: "diwali10" });
  assert.equal(calls[1]!.method, "DELETE");
});
