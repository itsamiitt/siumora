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
  {
    id: "0006_buyer_gstin",
    sql: `
-- A registered buyer's GSTIN, captured at checkout so the invoice carries it
-- and GSTR-1 files the supply invoice-wise rather than folding it into a B2C
-- summary the buyer cannot claim input credit against.
ALTER TABLE orders ADD COLUMN buyer_gstin text;

-- Structure only; the check digit is verified in the application, where a
-- refusal can explain itself to the person typing.
ALTER TABLE orders ADD CONSTRAINT orders_buyer_gstin_shape
  CHECK (buyer_gstin IS NULL OR buyer_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');

-- Partial: the B2B tables of GSTR-1 are built from exactly these rows, and they
-- are a small minority of orders.
CREATE INDEX orders_b2b_idx ON orders(financial_year) WHERE buyer_gstin IS NOT NULL;
`,
  },
  {
    id: "0007_cod_remittances",
    sql: `
-- COD is the majority of orders and the courier holds the cash for a week. Up
-- to now nothing recorded what came back, so a short collection or a silently
-- inflated deduction was invisible.
--
-- The row is kept after reconciliation rather than only reported: it is the
-- evidence a shortfall was claimed, and it is what stops a later batch
-- crediting the same order a second time.
CREATE TABLE cod_remittances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id text NOT NULL,
  courier text NOT NULL,
  -- Text, not a foreign key alone: a file may name an order this shop never
  -- sold, and refusing to store that row would hide the very error worth seeing.
  order_number text NOT NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  collected integer NOT NULL,
  deductions integer NOT NULL DEFAULT 0,
  remitted integer NOT NULL,
  declared_weight_grams integer,
  charged_weight_grams integer,
  outcome text NOT NULL,
  variance integer NOT NULL DEFAULT 0,
  note text,
  remitted_on timestamptz,
  reconciled_at timestamptz NOT NULL DEFAULT now(),

  -- Money never moves backwards at the door, and a negative deduction would
  -- quietly turn a courier's charge into income.
  CONSTRAINT cod_remittance_amounts_non_negative
    CHECK (collected >= 0 AND deductions >= 0),

  CONSTRAINT cod_remittance_outcome_known CHECK (
    outcome IN ('matched', 'short', 'over', 'unknown_order',
                'not_cod', 'not_delivered', 'duplicate')
  ),

  -- An order with no matching sale has nothing to be short of, so a variance
  -- there would be a number with no meaning.
  CONSTRAINT cod_remittance_variance_needs_order
    CHECK (outcome <> 'duplicate' OR variance = 0)
);

-- Couriers resend files routinely. Re-uploading one must not book the money
-- twice, so the batch line is the idempotency key.
CREATE UNIQUE INDEX cod_remittance_batch_order_key
  ON cod_remittances(batch_id, order_number);

-- "Has this order already been paid for?" — asked once per row of every batch.
CREATE INDEX cod_remittance_order_idx ON cod_remittances(order_number);
`,
  },
  {
    id: "0008_tracking_retry",
    sql: `
-- The ledger recorded attempts but nothing said *when* to try again, so a
-- refused send was retried on the very next pass. Against a rate limit that
-- turns a queue into a hammer.
ALTER TABLE tracking_events ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();

-- What the destination actually said. Without it a failed row is a dead end:
-- an operator can see that five attempts were refused but not why.
ALTER TABLE tracking_events ADD COLUMN last_error text;

-- 'sending' is the claim, and it has to be a persisted state.
-- SELECT ... FOR UPDATE SKIP LOCKED only holds a row for the length of its
-- transaction, and the alternative — keeping one open across an HTTP call —
-- ties a database connection to a third party's latency. Without a claim two
-- workers post the same conversion, and the unique index cannot stop a
-- duplicate *post*, only a duplicate row.
ALTER TABLE tracking_events ADD CONSTRAINT tracking_event_status_known
  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped'));

-- The queue the worker reads: due, not yet done.
CREATE INDEX tracking_event_due_idx
  ON tracking_events(next_attempt_at)
  WHERE status IN ('pending', 'sending');
`,
  },
  {
    id: "0009_privacy_requests",
    sql: `
-- Data-principal rights under the DPDP Act 2023 (plan/11 §5). A request is
-- recorded rather than acted on inline, because the deadline is the regulated
-- part: 48 hours to acknowledge, a month to resolve, and a queue nobody can see
-- is a queue that runs over.
CREATE TABLE privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  -- Kept alongside the reference: an erasure that succeeds nulls the customer
  -- link, and a request whose subject cannot be named afterwards is unauditable.
  subject_phone text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'received',
  -- Why it was refused, or why it could not run yet. A refusal with no reason
  -- is indistinguishable from being ignored.
  note text,
  received_at timestamptz NOT NULL DEFAULT now(),
  acknowledge_by timestamptz NOT NULL,
  resolve_by timestamptz NOT NULL,
  completed_at timestamptz,

  CONSTRAINT privacy_request_kind_known
    CHECK (kind IN ('access', 'correction', 'erasure')),
  CONSTRAINT privacy_request_status_known
    CHECK (status IN ('received', 'acknowledged', 'completed', 'refused')),
  -- A finished request has a finish time, and an unfinished one does not claim
  -- to have finished.
  CONSTRAINT privacy_request_completion_consistent CHECK (
    (status IN ('completed', 'refused')) = (completed_at IS NOT NULL)
  )
);

-- One open request per person per kind. Asking twice is impatience, not a
-- second right, and two open erasures race each other.
CREATE UNIQUE INDEX privacy_request_open_key
  ON privacy_requests(subject_phone, kind)
  WHERE status IN ('received', 'acknowledged');

-- The queue: unfinished, soonest deadline first.
CREATE INDEX privacy_request_due_idx
  ON privacy_requests(resolve_by)
  WHERE status IN ('received', 'acknowledged');

-- Marks a customer whose personal data has been redacted. The row itself stays:
-- orders reference it, and orphaning them would break the invoice trail that
-- section 36 of the CGST Act requires be kept for six years.
ALTER TABLE customers ADD COLUMN erased_at timestamptz;

-- The phone constraint exists so a shopper who types +91 once and 0 the next
-- time does not become two customers. An erased row has no phone number at all
-- — it carries a token, because the column is NOT NULL and uniquely indexed and
-- something has to sit there. The exception is named rather than the constraint
-- dropped: a malformed *live* number must still be impossible.
ALTER TABLE customers DROP CONSTRAINT customers_phone_normalised;
ALTER TABLE customers ADD CONSTRAINT customers_phone_normalised
  CHECK (phone ~ '^[6-9][0-9]{9}$' OR phone ~ '^erased:[0-9a-f-]{36}$');

-- And the two states must agree: a token phone means erased, and erased means a
-- token phone. Either one alone is a row nobody can interpret.
ALTER TABLE customers ADD CONSTRAINT customers_erasure_consistent
  CHECK ((phone LIKE 'erased:%') = (erased_at IS NOT NULL));
`,
  },
  {
    id: "0010_audit_log",
    sql: `
-- Every admin write, with the person who made it (plan/11 §4). Until now an
-- order could be cancelled, a remittance booked or a customer erased with no
-- record of who did it — which is the same as nobody having done it.
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deliberately not a foreign key. The log outlives the rows it describes, and
  -- a cascade or a SET NULL is the database editing an append-only table — which
  -- the rules below refuse, leaving the constraint permanently unsatisfiable.
  -- An operator who is erased must not take the record of their actions away.
  actor_id uuid,
  -- Which is why the number is stored beside it. This is an internal
  -- accountability record, so it is stored whole.
  actor_phone text NOT NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  -- What was acted on: an order number, a batch id, a request id.
  subject text,
  detail jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT audit_actor_role_known
    CHECK (actor_role IN ('viewer', 'operator', 'owner'))
);

CREATE INDEX audit_log_recent_idx ON audit_log(created_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log(actor_phone, created_at DESC);
CREATE INDEX audit_log_subject_idx ON audit_log(subject) WHERE subject IS NOT NULL;

-- Append-only, enforced rather than intended.
--
-- A log the application merely promises not to edit is a log an attacker with
-- the application's credentials can edit, and those are the credentials worth
-- taking. The rule refuses at the database, so covering tracks needs a
-- privilege the API does not have. TRUNCATE is not intercepted, which is what
-- the test suite uses to reset between cases — it is also a privilege no
-- production role should hold.
CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;
`,
  },
  {
    id: "0011_notifications",
    sql: `
-- The notification outbox (plan/06). Enqueued by whatever moved the order and
-- drained by the worker, so a checkout never waits on WhatsApp — and a message
-- that fails to send is a row somebody can find rather than a log line nobody
-- read.
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What caused this, and the reason a retried webhook cannot double-send: one
  -- row per event per template, enforced below.
  event_key text NOT NULL,
  template_key text NOT NULL,
  category text NOT NULL,
  -- Ten digits, or an email address. Kept denormalised because a message is
  -- addressed to where it was sent, not to wherever the customer row points now.
  recipient text NOT NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  -- The template variables. Stored so a retry renders the same message rather
  -- than re-deriving it from an order that has since moved on.
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  channel text,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  -- Quiet hours push this forward; so does a backoff after a refusal.
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  -- The provider's id, which is what a delivery receipt arrives against.
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notification_category_known CHECK (category IN ('utility', 'marketing')),
  CONSTRAINT notification_status_known CHECK (
    status IN ('pending', 'sending', 'sent', 'failed', 'skipped')
  ),
  CONSTRAINT notification_attempts_nonneg CHECK (attempts >= 0)
);

-- A retried webhook, a double-clicked status change, a replayed courier
-- callback: all of them must produce one message.
CREATE UNIQUE INDEX notification_event_template_key
  ON notifications(event_key, template_key);

CREATE INDEX notification_due_idx
  ON notifications(next_attempt_at)
  WHERE status IN ('pending', 'sending');

CREATE INDEX notification_recipient_idx ON notifications(recipient, created_at DESC);

-- Who has asked not to be messaged, and what they still agreed to. Keyed on the
-- number rather than the customer: a guest who never signed in can still opt
-- out, and their wish has to outlive the order.
CREATE TABLE notification_preferences (
  recipient text PRIMARY KEY,
  -- Marketing is opt-in. Utility rides on having placed an order.
  marketing_consent boolean NOT NULL DEFAULT false,
  -- Stops everything, including utility. It is a person asking to be left alone.
  opted_out boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
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
