import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Database schema.
 *
 * Two rules run through all of it:
 *
 * 1. **Money is integer paise.** Never numeric, never float. A rupee value that
 *    goes through a float loses paise, and a tax total that is out by a paisa
 *    is a mismatched invoice. `integer` holds ₹21 crore, far past any order.
 * 2. **Timestamps are `timestamptz`.** A naive timestamp silently means
 *    whatever the server's zone is, and an order placed at 11pm IST would land
 *    on the wrong day in a UTC report — and in the wrong financial year every
 *    31 March.
 */

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    handle: text("handle").notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle").notNull().default(""),
    description: text("description").notNull().default(""),
    /** HSN code — required on the GST invoice. */
    hsn: text("hsn").notNull(),
    /** 0, 5, 18 or 40. Constrained in the domain layer. */
    gstSlab: smallint("gst_slab").notNull(),
    material: text("material").notNull().default(""),
    /** Drives the returns hygiene exception. */
    piercedJewellery: boolean("pierced_jewellery").notNull().default(false),
    images: jsonb("images").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("products_handle_key").on(table.handle)],
);

export const variants = pgTable(
  "variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** The id Merchant Center and the Meta catalog key on. */
    sku: text("sku").notNull(),
    title: text("title").notNull(),
    /** Maximum retail price in paise, tax-inclusive. */
    mrp: integer("mrp").notNull(),
    /** Selling price in paise, tax-inclusive. */
    price: integer("price").notNull(),
    inventory: integer("inventory").notNull().default(0),
  },
  (table) => [
    uniqueIndex("variants_sku_key").on(table.sku),
    index("variants_product_idx").on(table.productId),
  ],
);

export const collections = pgTable(
  "collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    handle: text("handle").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
  },
  (table) => [uniqueIndex("collections_handle_key").on(table.handle)],
);

export const productCollections = pgTable(
  "product_collections",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.productId, table.collectionId] })],
);

export const carts = pgTable("carts", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cartLines = pgTable(
  "cart_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
  },
  (table) => [
    // One row per variant per cart; adding again bumps the quantity.
    uniqueIndex("cart_lines_cart_variant_key").on(table.cartId, table.variantId),
  ],
);

/**
 * A person, identified by their mobile number.
 *
 * The number is the identity because it is already the delivery contact and
 * the WhatsApp thread — an email and password would be a second, weaker copy
 * of the same fact. Stored normalised to ten digits, enforced by a CHECK, so
 * one shopper is always one row.
 */
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: text("phone").notNull(),
    name: text("name").notNull().default(""),
    email: text("email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("customers_phone_key").on(table.phone)],
);

/**
 * One issued sign-in code.
 *
 * `codeHash` rather than the code: this table is read by anyone with database
 * access, and a live code is a live account.
 */
export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    requestedIp: text("requested_ip").notNull().default(""),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("otp_phone_created_idx").on(table.phone, table.createdAt)],
);

/**
 * A signed-in session.
 *
 * Admin is deliberately not a column here. Operator access is derived at
 * request time from the `ADMIN_PHONES` allow-list, so removing a number from
 * the environment takes effect on the next request rather than whenever a
 * long-lived session happens to expire.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    userAgent: text("user_agent").notNull().default(""),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_key").on(table.tokenHash),
    index("sessions_customer_idx").on(table.customerId),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Customer-facing, e.g. SIU-00042. */
    number: text("number").notNull(),
    status: text("status").notNull(),
    paymentMethod: text("payment_method").notNull(),
    /** Delivery state differs from the registered state. Decides IGST. */
    interState: boolean("inter_state").notNull(),
    address: jsonb("address").notNull(),

    // Totals in paise, snapshotted at placement. Recomputing them later from a
    // catalogue that has since been repriced would restate a settled invoice.
    subtotal: integer("subtotal").notNull(),
    shipping: integer("shipping").notNull().default(0),
    codFee: integer("cod_fee").notNull().default(0),
    total: integer("total").notNull(),
    taxableValue: integer("taxable_value").notNull(),
    cgst: integer("cgst").notNull().default(0),
    sgst: integer("sgst").notNull().default(0),
    igst: integer("igst").notNull().default(0),

    invoiceNumber: text("invoice_number"),
    /** Monotonic within a financial year. */
    invoiceSequence: integer("invoice_sequence"),
    financialYear: text("financial_year"),

    /** Shared analytics dedup id — the same value goes to pixel and server. */
    eventId: uuid("event_id").notNull(),

    /** Null for a guest order. Guest checkout stays: sign-in gates cost sales. */
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    /** What actually authorises reading a guest order — the number is guessable. */
    accessKey: uuid("access_key").notNull().defaultRandom(),
    /** Snapshotted, because it is what the RTO score used at placement. */
    phoneVerified: boolean("phone_verified").notNull().default(false),
    /** When the goods went back on the shelf. Null means they still owe stock. */
    restockedAt: timestamp("restocked_at", { withTimezone: true }),
    /** The browser's GA4 client id, captured at checkout. Null when blocked. */
    gaClientId: text("ga_client_id"),
    /** A registered buyer's GSTIN. Present makes this a B2B supply in GSTR-1. */
    buyerGstin: text("buyer_gstin"),

    deliveryAttempts: integer("delivery_attempts").notNull().default(0),
    ndrReason: text("ndr_reason"),

    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("orders_number_key").on(table.number),
    // The GST series must be unique within its financial year, enforced by the
    // database rather than by whichever process happens to be writing.
    uniqueIndex("orders_invoice_key").on(table.financialYear, table.invoiceSequence),
    index("orders_status_idx").on(table.status),
    index("orders_placed_idx").on(table.placedAt),
    index("orders_customer_idx").on(table.customerId, table.placedAt),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** Not a foreign key: a variant may be deleted, the order line may not. */
    variantId: uuid("variant_id").notNull(),
    sku: text("sku").notNull(),
    productHandle: text("product_handle").notNull(),
    title: text("title").notNull(),
    variantTitle: text("variant_title").notNull(),
    imageUrl: text("image_url").notNull().default(""),
    mrp: integer("mrp").notNull(),
    unitPrice: integer("unit_price").notNull(),
    quantity: integer("quantity").notNull(),
    gstSlab: smallint("gst_slab").notNull(),
    hsn: text("hsn").notNull(),
    piercedJewellery: boolean("pierced_jewellery").notNull().default(false),
  },
  (table) => [index("order_lines_order_idx").on(table.orderId)],
);

export const returnRequests = pgTable(
  "return_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    variantIds: jsonb("variant_ids").notNull(),
    reason: text("reason").notNull(),
    resolution: text("resolution").notNull(),
    status: text("status").notNull(),
    refundTo: text("refund_to").notNull(),
    freeReturnShipping: boolean("free_return_shipping").notNull().default(false),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("returns_order_idx").on(table.orderId)],
);

export const ndrEvents = pgTable(
  "ndr_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    attempt: integer("attempt").notNull(),
    resolution: text("resolution"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ndr_order_idx").on(table.orderId)],
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    rating: smallint("rating").notNull(),
    title: text("title").notNull().default(""),
    body: text("body").notNull().default(""),
    authorName: text("author_name").notNull(),
    /** Only verified buyers count toward the published rating. */
    verifiedBuyer: boolean("verified_buyer").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("reviews_product_idx").on(table.productId)],
);

export const wishlistItems = pgTable(
  "wishlist_items",
  {
    wishlistId: uuid("wishlist_id").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.wishlistId, table.productId] })],
);

/**
 * Ledger of analytics events sent server-side.
 *
 * Exists so a retry reuses the original `event_id` instead of minting a new
 * one — a fresh id per attempt is double-counted revenue in Meta and GA4.
 */
export const trackingEvents = pgTable(
  "tracking_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull(),
    eventName: text("event_name").notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    destination: text("destination").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    payload: jsonb("payload"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One send per event per destination, enforced by the database.
    uniqueIndex("tracking_event_destination_key").on(table.eventId, table.destination),
  ],
);

/**
 * Idempotency keys.
 *
 * A retried checkout — a flaky network, an impatient tap — must not create two
 * orders. The key is unique, so the second attempt collides and returns the
 * first response instead of charging twice.
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    /** Guards against the same key being reused for a different request. */
    requestHash: text("request_hash").notNull(),
    response: jsonb("response"),
    status: text("status").notNull().default("in_progress"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idempotency_created_idx").on(table.createdAt)],
);

export const consentLog = pgTable("consent_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  subjectId: text("subject_id").notNull(),
  analytics: boolean("analytics").notNull(),
  ads: boolean("ads").notNull(),
  personalisation: boolean("personalisation").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pincodeServiceability = pgTable("pincode_serviceability", {
  pincode: text("pincode").primaryKey(),
  city: text("city").notNull().default(""),
  stateCode: text("state_code").notNull(),
  serviceable: boolean("serviceable").notNull().default(true),
  codAvailable: boolean("cod_available").notNull().default(false),
  estimatedDays: text("estimated_days").notNull().default("4–6"),
  /** Historical RTO rate in basis points — integer, so no float drift. */
  rtoRateBps: integer("rto_rate_bps").notNull().default(0),
});

export const productsRelations = relations(products, ({ many }) => ({
  variants: many(variants),
  reviews: many(reviews),
  productCollections: many(productCollections),
}));

export const variantsRelations = relations(variants, ({ one }) => ({
  product: one(products, {
    fields: [variants.productId],
    references: [products.id],
  }),
}));

export const ordersRelations = relations(orders, ({ many, one }) => ({
  lines: many(orderLines),
  returns: many(returnRequests),
  ndrEvents: many(ndrEvents),
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
}));

export const customersRelations = relations(customers, ({ many }) => ({
  orders: many(orders),
  sessions: many(sessions),
}));

export const orderLinesRelations = relations(orderLines, ({ one }) => ({
  order: one(orders, { fields: [orderLines.orderId], references: [orders.id] }),
}));
