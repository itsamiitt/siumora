import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import type pg from "pg";

import { createDb, createPool, type Database } from "./client.ts";
import { createTestDatabase, type TestDatabase } from "./testing.ts";
import { migrate } from "./migrate.ts";
import {
  addCartLine,
  createCart,
  getCartLines,
  getOrderByNumber,
  listProducts,
  placeOrder,
} from "./repositories.ts";
import { seed } from "./seed.ts";
import { orderLines, orders, variants } from "./schema.ts";
import { eq } from "drizzle-orm";

/**
 * Repository tests against a real Postgres.
 *
 * The concurrency test is the one that matters: it runs two checkouts at the
 * same time against a single unit of stock and asserts exactly one wins. That
 * behaviour cannot be demonstrated with an in-memory fake, which is why the
 * database is real here.
 */
const url = process.env.DATABASE_URL;
let testDb: TestDatabase | undefined;
const dbTest = url ? test : test.skip;

let pool: pg.Pool;
let db: Database;

const ADDRESS = {
  name: "Asha Menon",
  phone: "9876543210",
  line1: "Flat 3B, Sunrise Apartments",
  city: "Mumbai",
  stateCode: "27",
  pincode: "400001",
};

before(async () => {
  if (!url) return;
  testDb = await createTestDatabase("db_repos");
  pool = createPool({ connectionString: testDb!.url });
  await migrate(pool);
  db = createDb(pool);
});

beforeEach(async () => {
  if (!url) return;
  await pool.query("DELETE FROM order_lines; DELETE FROM orders; DELETE FROM cart_lines; DELETE FROM carts;");
  await seed(testDb!.url);
});

after(async () => {
  if (pool) await pool.end();
});

async function variantBySku(sku: string) {
  const [row] = await db.select().from(variants).where(eq(variants.sku, sku));
  return row!;
}

dbTest("reads the catalogue with variants and collections", async () => {
  const all = await listProducts(db);
  const studs = all.find((p) => p.handle === "petal-studs")!;

  assert.equal(studs.variants.length, 2);
  assert.ok(studs.collections.includes("everyday"));
  assert.equal(studs.piercedJewellery, true);
});

dbTest("refuses to add a sold-out variant", async () => {
  const cart = await createCart(db);
  const soldOut = await variantBySku("SIU-JH-SLV");

  const result = await addCartLine(db, cart, soldOut.id, 1);
  assert.equal(result.ok, false);
});

dbTest("refuses to add more than the stock on hand", async () => {
  const cart = await createCart(db);
  const variant = await variantBySku("SIU-KP-GLD"); // 8 in stock

  assert.equal((await addCartLine(db, cart, variant.id, 8)).ok, true);
  const over = await addCartLine(db, cart, variant.id, 1);
  assert.equal(over.ok, false);
});

dbTest("places an order, decrements stock and empties the cart", async () => {
  const cart = await createCart(db);
  const variant = await variantBySku("SIU-PS-GLD");
  const before = variant.inventory;

  await addCartLine(db, cart, variant.id, 2);
  const result = await placeOrder(db, {
    cartId: cart,
    address: ADDRESS,
    paymentMethod: "upi",
    status: "confirmed",
    eventId: crypto.randomUUID(),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const after = await variantBySku("SIU-PS-GLD");
  assert.equal(after.inventory, before - 2);
  assert.deepEqual(await getCartLines(db, cart), []);

  const order = await getOrderByNumber(db, result.order.number);
  assert.equal(order?.lines.length, 1);
  assert.equal(order?.lines[0]?.quantity, 2);
});

dbTest("stores tax that balances against the total", async () => {
  const cart = await createCart(db);
  const variant = await variantBySku("SIU-PS-GLD");
  await addCartLine(db, cart, variant.id, 1);

  const result = await placeOrder(db, {
    cartId: cart,
    address: ADDRESS,
    paymentMethod: "upi",
    status: "confirmed",
    eventId: crypto.randomUUID(),
  });
  assert.ok(result.ok);

  const order = await getOrderByNumber(db, result.order.number);
  assert.equal(
    order!.taxableValue + order!.cgst + order!.sgst + order!.igst,
    order!.total,
  );
  // Maharashtra to Maharashtra is intra-state.
  assert.equal(order!.igst, 0);
  assert.ok(order!.cgst > 0);
});

dbTest("charges IGST on an inter-state order", async () => {
  const cart = await createCart(db);
  await addCartLine(db, cart, (await variantBySku("SIU-PS-GLD")).id, 1);

  const result = await placeOrder(db, {
    cartId: cart,
    address: { ...ADDRESS, stateCode: "29", city: "Bengaluru", pincode: "560001" },
    paymentMethod: "upi",
    status: "confirmed",
    eventId: crypto.randomUUID(),
  });
  assert.ok(result.ok);

  const order = await getOrderByNumber(db, result.order.number);
  assert.equal(order!.cgst, 0);
  assert.ok(order!.igst > 0);
});

dbTest("issues an invoice only for a confirmed order", async () => {
  const cartA = await createCart(db);
  await addCartLine(db, cartA, (await variantBySku("SIU-PS-GLD")).id, 1);
  const held = await placeOrder(db, {
    cartId: cartA,
    address: ADDRESS,
    paymentMethod: "cod",
    status: "awaiting_cod_confirmation",
    eventId: crypto.randomUUID(),
  });
  assert.ok(held.ok);
  // A held order must not burn a number out of a gapless series.
  assert.equal(held.order.invoiceNumber, null);

  const cartB = await createCart(db);
  await addCartLine(db, cartB, (await variantBySku("SIU-TB-12")).id, 1);
  const confirmed = await placeOrder(db, {
    cartId: cartB,
    address: ADDRESS,
    paymentMethod: "upi",
    status: "confirmed",
    eventId: crypto.randomUUID(),
  });
  assert.ok(confirmed.ok);
  assert.match(confirmed.order.invoiceNumber ?? "", /^SIU\/\d{4}-\d{2}\/\d{6}$/);
});

dbTest("does not oversell the last unit under concurrent checkout", async () => {
  // Two shoppers, one unit. Without the row lock both read stock as 1, both
  // pass the check, and the warehouse owes a piece it does not have.
  const variant = await variantBySku("SIU-KP-GLD");
  await db.update(variants).set({ inventory: 1 }).where(eq(variants.id, variant.id));

  const cartA = await createCart(db);
  const cartB = await createCart(db);
  await addCartLine(db, cartA, variant.id, 1);
  await addCartLine(db, cartB, variant.id, 1);

  const place = (cartId: string) =>
    placeOrder(db, {
      cartId,
      address: ADDRESS,
      paymentMethod: "upi",
      status: "confirmed",
      eventId: crypto.randomUUID(),
    }).catch((error: Error) => ({ ok: false as const, message: error.message }));

  const [a, b] = await Promise.all([place(cartA), place(cartB)]);
  const winners = [a, b].filter((r) => r.ok);

  assert.equal(winners.length, 1, "exactly one checkout should win the last unit");

  const after = await variantBySku("SIU-KP-GLD");
  assert.equal(after.inventory, 0, "stock must never go negative");
});

dbTest("gives concurrent orders distinct numbers and invoice sequences", async () => {
  const carts = await Promise.all([createCart(db), createCart(db), createCart(db)]);
  const variant = await variantBySku("SIU-PS-GLD");
  for (const cart of carts) await addCartLine(db, cart, variant.id, 1);

  const results = await Promise.all(
    carts.map((cartId) =>
      placeOrder(db, {
        cartId,
        address: ADDRESS,
        paymentMethod: "upi",
        status: "confirmed",
        eventId: crypto.randomUUID(),
      }).catch((error: Error) => ({ ok: false as const, message: error.message })),
    ),
  );

  const placed = results.filter((r) => r.ok);
  assert.equal(placed.length, 3);

  const numbers = new Set(placed.map((r) => r.order.number));
  const invoices = new Set(placed.map((r) => r.order.invoiceNumber));
  assert.equal(numbers.size, 3, "order numbers must be unique");
  assert.equal(invoices.size, 3, "invoice numbers must be unique");
});

dbTest("rolls back everything when an order fails mid-flight", async () => {
  const variant = await variantBySku("SIU-KP-GLD");
  await db.update(variants).set({ inventory: 0 }).where(eq(variants.id, variant.id));

  const cart = await createCart(db);
  // Force a line onto the cart despite the stock, to simulate a race where the
  // stock disappeared between add and checkout.
  await pool.query(
    "INSERT INTO cart_lines (cart_id, variant_id, quantity) VALUES ($1, $2, 1)",
    [cart, variant.id],
  );

  const result = await placeOrder(db, {
    cartId: cart,
    address: ADDRESS,
    paymentMethod: "upi",
    status: "confirmed",
    eventId: crypto.randomUUID(),
  });

  assert.equal(result.ok, false);

  // No order, no lines, and stock untouched.
  const allOrders = await db.select().from(orders);
  const allLines = await db.select().from(orderLines);
  assert.equal(allOrders.length, 0);
  assert.equal(allLines.length, 0);
  assert.equal((await variantBySku("SIU-KP-GLD")).inventory, 0);
});
