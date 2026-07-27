import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type pg from "pg";

import { createPool } from "./client.ts";
import { migrate } from "./migrate.ts";

/**
 * Constraint tests against a real Postgres.
 *
 * These assert that the database refuses bad data on its own. Application code
 * can be bypassed — by a migration script, a console, a future service — but a
 * CHECK constraint cannot, so the invariants that would corrupt an invoice
 * belong here and are worth proving.
 *
 * Skipped when DATABASE_URL is unset so the suite still runs without a server.
 */
const url = process.env.DATABASE_URL;
const describeDb = url ? test : test.skip;

let pool: pg.Pool;

before(async () => {
  if (!url) return;
  pool = createPool({ connectionString: url });
  await migrate(pool);
  await pool.query("DELETE FROM order_lines; DELETE FROM orders;");
});

after(async () => {
  if (pool) await pool.end();
});

async function insertOrder(overrides: Record<string, number | string> = {}) {
  const values = {
    number: `T-${Math.random().toString(36).slice(2, 10)}`,
    status: "confirmed",
    payment_method: "upi",
    inter_state: false,
    subtotal: 100000,
    shipping: 0,
    cod_fee: 0,
    total: 100000,
    taxable_value: 95238,
    cgst: 2381,
    sgst: 2381,
    igst: 0,
    ...overrides,
  } as Record<string, unknown>;

  const keys = Object.keys(values);
  const params = keys.map((_, i) => `$${i + 1}`).join(", ");

  return pool.query(
    `INSERT INTO orders (${keys.join(", ")}, address, event_id)
     VALUES (${params}, '{}'::jsonb, gen_random_uuid())`,
    Object.values(values),
  );
}

describeDb("accepts an order whose tax balances against the total", async () => {
  await assert.doesNotReject(() => insertOrder());
});

describeDb("refuses an order where tax does not add up to the total", async () => {
  // If these ever disagree the invoice does not balance. The database is the
  // last place that can still say no.
  await assert.rejects(
    () => insertOrder({ cgst: 9999 }),
    /orders_total_balances/,
  );
});

describeDb("refuses a total that is not subtotal plus shipping and fee", async () => {
  await assert.rejects(
    () => insertOrder({ shipping: 7900 }),
    /orders_total_is_sum|orders_total_balances/,
  );
});

describeDb("refuses an order charged both IGST and CGST", async () => {
  // A sale is intra-state or inter-state, never both.
  await assert.rejects(
    () =>
      insertOrder({
        cgst: 2381,
        sgst: 2381,
        igst: 4762,
        taxable_value: 90476,
      }),
    /orders_gst_split_consistent/,
  );
});

describeDb("refuses negative money", async () => {
  await assert.rejects(
    () => insertOrder({ subtotal: -1, total: -1, taxable_value: -1 }),
    /orders_money_nonneg|orders_total/,
  );
});

describeDb("refuses two invoices with the same number in one financial year", async () => {
  // The GST series has to be unique within its year, whatever process writes it.
  await insertOrder({ invoice_sequence: 1, financial_year: "2026-27" });
  await assert.rejects(
    () => insertOrder({ invoice_sequence: 1, financial_year: "2026-27" }),
    /orders_invoice_key/,
  );
});

describeDb("allows the same sequence in a different financial year", async () => {
  await assert.doesNotReject(() =>
    insertOrder({ invoice_sequence: 1, financial_year: "2027-28" }),
  );
});

describeDb("refuses an invalid GST slab on a product", async () => {
  await assert.rejects(
    () =>
      pool.query(
        `INSERT INTO products (handle, title, hsn, gst_slab)
         VALUES ('bad-slab', 'x', '7113', 12)`,
      ),
    /products_gst_slab_valid/,
  );
});

describeDb("refuses a selling price above MRP", async () => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO products (handle, title, hsn, gst_slab)
     VALUES ('price-check', 'x', '7113', 5) RETURNING id`,
  );

  await assert.rejects(
    () =>
      pool.query(
        `INSERT INTO variants (product_id, sku, title, mrp, price)
         VALUES ($1, 'SKU-BAD', 'x', 1000, 2000)`,
        [rows[0]!.id],
      ),
    /variants_price_not_above_mrp/,
  );
});

describeDb("refuses a rating outside one to five", async () => {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO products (handle, title, hsn, gst_slab)
     VALUES ('rating-check', 'x', '7113', 5) RETURNING id`,
  );

  await assert.rejects(
    () =>
      pool.query(
        `INSERT INTO reviews (product_id, rating, author_name)
         VALUES ($1, 6, 'A')`,
        [rows[0]!.id],
      ),
    /reviews_rating_range/,
  );
});

describeDb("refuses a duplicate tracking send to one destination", async () => {
  // A retry that minted a new id would be counted as a second conversion.
  const eventId = "11111111-1111-1111-1111-111111111111";
  await pool.query(
    `INSERT INTO tracking_events (event_id, event_name, destination)
     VALUES ($1, 'purchase', 'meta')`,
    [eventId],
  );

  await assert.rejects(
    () =>
      pool.query(
        `INSERT INTO tracking_events (event_id, event_name, destination)
         VALUES ($1, 'purchase', 'meta')`,
        [eventId],
      ),
    /tracking_event_destination_key/,
  );

  // The same event going to a different platform is legitimate.
  await assert.doesNotReject(() =>
    pool.query(
      `INSERT INTO tracking_events (event_id, event_name, destination)
       VALUES ($1, 'purchase', 'ga4')`,
      [eventId],
    ),
  );
});

describeDb("is idempotent when migrations run twice", async () => {
  const applied = await migrate(pool);
  assert.deepEqual(applied, []);
});
