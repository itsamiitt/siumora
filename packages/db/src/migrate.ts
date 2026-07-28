import pg from "pg";

/**
 * Migrations.
 *
 * Written as plain SQL and applied in order, each inside a transaction and
 * recorded in `_migrations`. Hand-written rather than generated so that the
 * constraints carrying business meaning — the GST series uniqueness, the money
 * checks — are visible and reviewable rather than buried in a diff.
 *
 * Applied statements are never edited. A change is a new migration.
 */

export interface Migration {
  readonly id: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: "0001_initial",
    sql: `
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle text NOT NULL UNIQUE,
  title text NOT NULL,
  subtitle text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  hsn text NOT NULL,
  gst_slab smallint NOT NULL,
  material text NOT NULL DEFAULT '',
  pierced_jewellery boolean NOT NULL DEFAULT false,
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Only the slabs the GST regime actually has. A typo'd rate would silently
  -- misprice every invoice for that product.
  CONSTRAINT products_gst_slab_valid CHECK (gst_slab IN (0, 5, 18, 40))
);

CREATE TABLE variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku text NOT NULL UNIQUE,
  title text NOT NULL,
  mrp integer NOT NULL,
  price integer NOT NULL,
  inventory integer NOT NULL DEFAULT 0,
  -- Money is paise and can never be negative; a selling price above MRP would
  -- make the discount chip nonsense and the invoice wrong.
  CONSTRAINT variants_money_nonneg CHECK (mrp >= 0 AND price >= 0),
  CONSTRAINT variants_price_not_above_mrp CHECK (price <= mrp),
  CONSTRAINT variants_inventory_nonneg CHECK (inventory >= 0)
);
CREATE INDEX variants_product_idx ON variants(product_id);

CREATE TABLE collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL DEFAULT ''
);

CREATE TABLE product_collections (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, collection_id)
);

CREATE TABLE carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cart_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  quantity integer NOT NULL,
  CONSTRAINT cart_lines_quantity_positive CHECK (quantity > 0)
);
CREATE UNIQUE INDEX cart_lines_cart_variant_key ON cart_lines(cart_id, variant_id);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  status text NOT NULL,
  payment_method text NOT NULL,
  inter_state boolean NOT NULL,
  address jsonb NOT NULL,
  subtotal integer NOT NULL,
  shipping integer NOT NULL DEFAULT 0,
  cod_fee integer NOT NULL DEFAULT 0,
  total integer NOT NULL,
  taxable_value integer NOT NULL,
  cgst integer NOT NULL DEFAULT 0,
  sgst integer NOT NULL DEFAULT 0,
  igst integer NOT NULL DEFAULT 0,
  invoice_number text,
  invoice_sequence integer,
  financial_year text,
  event_id uuid NOT NULL,
  delivery_attempts integer NOT NULL DEFAULT 0,
  ndr_reason text,
  placed_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  CONSTRAINT orders_money_nonneg CHECK (
    subtotal >= 0 AND shipping >= 0 AND cod_fee >= 0 AND total >= 0
    AND taxable_value >= 0 AND cgst >= 0 AND sgst >= 0 AND igst >= 0
  ),
  -- The tax is contained in the total, never added to it. If these ever
  -- disagree the invoice does not balance, so the database refuses the row.
  CONSTRAINT orders_total_balances CHECK (total = taxable_value + cgst + sgst + igst),
  CONSTRAINT orders_total_is_sum CHECK (total = subtotal + shipping + cod_fee),
  -- A sale is intra-state or inter-state, never both.
  CONSTRAINT orders_gst_split_consistent CHECK (
    (igst = 0) OR (cgst = 0 AND sgst = 0)
  ),
  CONSTRAINT orders_attempts_nonneg CHECK (delivery_attempts >= 0)
);
-- The GST series must be gapless and unique within its financial year. Enforced
-- here rather than in whichever process happens to be writing.
CREATE UNIQUE INDEX orders_invoice_key
  ON orders(financial_year, invoice_sequence)
  WHERE invoice_sequence IS NOT NULL;
CREATE INDEX orders_status_idx ON orders(status);
CREATE INDEX orders_placed_idx ON orders(placed_at DESC);

CREATE TABLE order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL,
  sku text NOT NULL,
  product_handle text NOT NULL,
  title text NOT NULL,
  variant_title text NOT NULL,
  image_url text NOT NULL DEFAULT '',
  mrp integer NOT NULL,
  unit_price integer NOT NULL,
  quantity integer NOT NULL,
  gst_slab smallint NOT NULL,
  hsn text NOT NULL,
  pierced_jewellery boolean NOT NULL DEFAULT false,
  CONSTRAINT order_lines_quantity_positive CHECK (quantity > 0),
  CONSTRAINT order_lines_money_nonneg CHECK (mrp >= 0 AND unit_price >= 0)
);
CREATE INDEX order_lines_order_idx ON order_lines(order_id);

CREATE TABLE return_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_ids jsonb NOT NULL,
  reason text NOT NULL,
  resolution text NOT NULL,
  status text NOT NULL,
  refund_to text NOT NULL,
  free_return_shipping boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX returns_order_idx ON return_requests(order_id);
-- At most one open return per order; a second would refund the same piece twice.
CREATE UNIQUE INDEX returns_one_open_per_order
  ON return_requests(order_id)
  WHERE status <> 'rejected';

CREATE TABLE ndr_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reason text NOT NULL,
  attempt integer NOT NULL,
  resolution text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ndr_attempt_positive CHECK (attempt > 0)
);
CREATE INDEX ndr_order_idx ON ndr_events(order_id);

CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  rating smallint NOT NULL,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  author_name text NOT NULL,
  verified_buyer boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_rating_range CHECK (rating BETWEEN 1 AND 5)
);
CREATE INDEX reviews_product_idx ON reviews(product_id);

CREATE TABLE wishlist_items (
  wishlist_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wishlist_id, product_id)
);

CREATE TABLE tracking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  event_name text NOT NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  destination text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  payload jsonb,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- One send per event per destination. A retry that minted a new id would be
-- counted as a second conversion and double the reported revenue.
CREATE UNIQUE INDEX tracking_event_destination_key
  ON tracking_events(event_id, destination);

CREATE TABLE idempotency_keys (
  key text PRIMARY KEY,
  request_hash text NOT NULL,
  response jsonb,
  status text NOT NULL DEFAULT 'in_progress',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idempotency_created_idx ON idempotency_keys(created_at);

CREATE TABLE consent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id text NOT NULL,
  analytics boolean NOT NULL,
  ads boolean NOT NULL,
  personalisation boolean NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pincode_serviceability (
  pincode text PRIMARY KEY,
  city text NOT NULL DEFAULT '',
  state_code text NOT NULL,
  serviceable boolean NOT NULL DEFAULT true,
  cod_available boolean NOT NULL DEFAULT false,
  estimated_days text NOT NULL DEFAULT '4-6',
  rto_rate_bps integer NOT NULL DEFAULT 0,
  CONSTRAINT pincode_rto_rate_range CHECK (rto_rate_bps BETWEEN 0 AND 10000)
);
`,
  },
  {
    id: "0002_search_indexes",
    sql: `
-- Trigram indexes for typo-tolerant search until Meilisearch is in front.
CREATE INDEX products_title_trgm ON products USING gin (title gin_trgm_ops);
CREATE INDEX products_subtitle_trgm ON products USING gin (subtitle gin_trgm_ops);
`,
  },
  {
    id: "0003_customers_and_sessions",
    sql: `
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- Numbers are stored in one normalised form and nothing else. Without this a
  -- shopper who typed +91 once and 0 the next time becomes two customers, and
  -- their order history splits in half.
  CONSTRAINT customers_phone_normalised CHECK (phone ~ '^[6-9][0-9]{9}$')
);

CREATE TABLE otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  -- Hashed, never the code itself. A database dump must not be a set of live
  -- sign-in codes, and nobody with read access should be able to take over an
  -- account by watching this table.
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  requested_ip text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT otp_attempts_nonneg CHECK (attempts >= 0),
  CONSTRAINT otp_expiry_after_creation CHECK (expires_at > created_at)
);
-- The throttle reads the recent sends for one number; this is that query.
CREATE INDEX otp_phone_created_idx ON otp_challenges(phone, created_at DESC);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Hash again: the bearer token exists only in the customer's cookie.
  token_hash text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text NOT NULL DEFAULT '',
  CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);
CREATE INDEX sessions_customer_idx ON sessions(customer_id);

-- Orders become ownable. Nullable, because guest checkout stays: making
-- sign-in compulsory to buy costs more orders than the account is worth.
ALTER TABLE orders ADD COLUMN customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX orders_customer_idx ON orders(customer_id, placed_at DESC);

-- Order numbers are a readable sequence, so they are guessable. The access key
-- is what actually authorises reading a guest order; without it SIU-00001 and a
-- for-loop would walk every customer's address and phone number.
ALTER TABLE orders ADD COLUMN access_key uuid NOT NULL DEFAULT gen_random_uuid();

-- Recorded on the order rather than recomputed, because the RTO score that
-- decided the COD terms used this value at the time it was placed.
ALTER TABLE orders ADD COLUMN phone_verified boolean NOT NULL DEFAULT false;
`,
  },
  {
    id: "0004_restock",
    sql: `
-- Stock leaves at placement and nothing ever put it back, so every cancelled,
-- returned or returned-to-origin parcel permanently lost a sellable unit.
--
-- Recorded as a timestamp rather than a boolean: the restock is idempotent, and
-- when it happened is the question anyone reconciling stock actually asks.
ALTER TABLE orders ADD COLUMN restocked_at timestamptz;

-- The queue an operator works: ended, owed stock back, not yet put back.
CREATE INDEX orders_awaiting_restock_idx
  ON orders(status)
  WHERE restocked_at IS NULL AND status IN ('rto', 'returned', 'cancelled');
`,
  },
  {
    id: "0005_ga_client_id",
    sql: `
-- The GA4 Measurement Protocol will not accept an event without a client_id,
-- and only the browser has one — it lives in the _ga cookie. Without capturing
-- it at checkout the server half of the dual-send can never fire, which leaves
-- exactly the conversions that blockers ate unreported.
--
-- Nullable: a visitor with analytics blocked genuinely has none, and that is a
-- fact to record rather than a value to invent.
ALTER TABLE orders ADD COLUMN ga_client_id text;
`,
  },
];

/**
 * Apply any migration not yet recorded.
 *
 * Each runs inside its own transaction, so a failure leaves the database on the
 * last good migration rather than half-applied.
 */
export async function migrate(pool: pg.Pool): Promise<string[]> {
  const applied: string[] = [];

  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const { rows } = await pool.query<{ id: string }>("SELECT id FROM _migrations");
  const done = new Set(rows.map((row) => row.id));

  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) continue;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migration.sql);
      await client.query("INSERT INTO _migrations (id) VALUES ($1)", [migration.id]);
      await client.query("COMMIT");
      applied.push(migration.id);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(
        `migration ${migration.id} failed: ${(error as Error).message}`,
        { cause: error },
      );
    } finally {
      client.release();
    }
  }

  return applied;
}
