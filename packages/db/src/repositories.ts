import { and, desc, eq, inArray, sql } from "drizzle-orm";

import {
  awaitsRestock,
  calculateTotals,
  financialYear,
  invoiceNumber,
  isInterState,
  orderNumber as buildOrderNumber,
  shippingFor,
  type CartLine,
  type OrderStatus,
  type PaymentMethod,
  type ShippingAddress,
} from "@siumora/core";

import type { Database } from "./client.ts";
import {
  cartLines,
  carts,
  collections,
  orderLines,
  orders,
  productCollections,
  products,
  variants,
} from "./schema.ts";

/**
 * Data access.
 *
 * Every function that changes money or stock runs inside a transaction, and
 * reads the row it is about to change with `FOR UPDATE`. Without that lock two
 * simultaneous checkouts both see the last unit in stock and both succeed —
 * the classic oversell, and the reason this layer is not just a set of queries.
 */

export interface CatalogProduct {
  id: string;
  handle: string;
  title: string;
  subtitle: string;
  description: string;
  hsn: string;
  gstSlab: number;
  material: string;
  piercedJewellery: boolean;
  images: unknown;
  collections: string[];
  variants: Array<{
    id: string;
    sku: string;
    title: string;
    mrp: number;
    price: number;
    inventory: number;
  }>;
}

export async function listProducts(db: Database): Promise<CatalogProduct[]> {
  const rows = await db
    .select()
    .from(products)
    .leftJoin(variants, eq(variants.productId, products.id))
    .leftJoin(productCollections, eq(productCollections.productId, products.id))
    .leftJoin(collections, eq(collections.id, productCollections.collectionId));

  const byId = new Map<string, CatalogProduct>();

  for (const row of rows) {
    const product = row.products;
    let entry = byId.get(product.id);

    if (!entry) {
      entry = {
        id: product.id,
        handle: product.handle,
        title: product.title,
        subtitle: product.subtitle,
        description: product.description,
        hsn: product.hsn,
        gstSlab: product.gstSlab,
        material: product.material,
        piercedJewellery: product.piercedJewellery,
        images: product.images,
        collections: [],
        variants: [],
      };
      byId.set(product.id, entry);
    }

    if (row.variants && !entry.variants.some((v) => v.id === row.variants!.id)) {
      entry.variants.push({
        id: row.variants.id,
        sku: row.variants.sku,
        title: row.variants.title,
        mrp: row.variants.mrp,
        price: row.variants.price,
        inventory: row.variants.inventory,
      });
    }

    const handle = row.collections?.handle;
    if (handle && !entry.collections.includes(handle)) {
      entry.collections.push(handle);
    }
  }

  return [...byId.values()];
}

export async function getProduct(
  db: Database,
  handle: string,
): Promise<CatalogProduct | undefined> {
  const all = await listProducts(db);
  return all.find((product) => product.handle === handle);
}

export async function createCart(db: Database): Promise<string> {
  const [row] = await db.insert(carts).values({}).returning({ id: carts.id });
  return row!.id;
}

/**
 * Add to cart, or increase the quantity if the variant is already in it.
 *
 * The variant row is locked before its stock is read, so two simultaneous adds
 * of the last unit cannot both succeed.
 */
export async function addCartLine(
  db: Database,
  cartId: string,
  variantId: string,
  quantity: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  return db.transaction(async (tx) => {
    const locked = await tx.execute(
      sql`SELECT inventory FROM variants WHERE id = ${variantId} FOR UPDATE`,
    );
    const stock = (locked.rows[0] as { inventory: number } | undefined)?.inventory;
    if (stock === undefined) return { ok: false as const, message: "Not found." };
    if (stock <= 0) return { ok: false as const, message: "That option is sold out." };

    const [existing] = await tx
      .select()
      .from(cartLines)
      .where(and(eq(cartLines.cartId, cartId), eq(cartLines.variantId, variantId)));

    const desired = (existing?.quantity ?? 0) + quantity;
    if (desired > stock) {
      return { ok: false as const, message: `Only ${stock} left.` };
    }

    if (existing) {
      await tx
        .update(cartLines)
        .set({ quantity: desired })
        .where(eq(cartLines.id, existing.id));
    } else {
      await tx.insert(cartLines).values({ cartId, variantId, quantity });
    }

    return { ok: true as const };
  });
}

export async function setCartLineQuantity(
  db: Database,
  cartId: string,
  variantId: string,
  quantity: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (quantity <= 0) {
    await db
      .delete(cartLines)
      .where(and(eq(cartLines.cartId, cartId), eq(cartLines.variantId, variantId)));
    return { ok: true };
  }

  return db.transaction(async (tx) => {
    const locked = await tx.execute(
      sql`SELECT inventory FROM variants WHERE id = ${variantId} FOR UPDATE`,
    );
    const stock = (locked.rows[0] as { inventory: number } | undefined)?.inventory;
    if (stock === undefined) return { ok: false as const, message: "Not found." };
    if (quantity > stock) return { ok: false as const, message: `Only ${stock} left.` };

    await tx
      .insert(cartLines)
      .values({ cartId, variantId, quantity })
      .onConflictDoUpdate({
        target: [cartLines.cartId, cartLines.variantId],
        set: { quantity },
      });

    return { ok: true as const };
  });
}

export async function getCartLines(
  db: Database,
  cartId: string,
): Promise<CartLine[]> {
  const rows = await db
    .select()
    .from(cartLines)
    .innerJoin(variants, eq(variants.id, cartLines.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(eq(cartLines.cartId, cartId));

  return rows.map((row) => ({
    variantId: row.variants.id,
    sku: row.variants.sku,
    productHandle: row.products.handle,
    title: row.products.title,
    variantTitle: row.variants.title,
    imageUrl:
      (row.products.images as Array<{ url?: string }> | null)?.[0]?.url ?? "",
    mrp: row.variants.mrp,
    unitPrice: row.variants.price,
    quantity: row.cart_lines.quantity,
    gstSlab: row.products.gstSlab as CartLine["gstSlab"],
    hsn: row.products.hsn,
    piercedJewellery: row.products.piercedJewellery,
  }));
}

export async function clearCart(db: Database, cartId: string): Promise<void> {
  await db.delete(cartLines).where(eq(cartLines.cartId, cartId));
}

export interface PlaceOrderInput {
  cartId: string;
  address: ShippingAddress;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  eventId: string;
  codFee?: number;
  now?: Date;
  /** Set when the shopper was signed in. Guest checkout leaves it undefined. */
  customerId?: string;
  /** Whether the contact number was proven by a code before the order was placed. */
  phoneVerified?: boolean;
}

export interface PlacedOrder {
  id: string;
  number: string;
  status: OrderStatus;
  invoiceNumber: string | null;
  /** Handed to the placer once. Reading a guest order later requires it. */
  accessKey: string;
}

/**
 * Place an order.
 *
 * Everything happens in one transaction: stock is decremented, the order and
 * its lines are written, the cart is emptied. A failure anywhere rolls back the
 * lot, so stock is never consumed by an order that does not exist.
 *
 * Order and invoice numbers come from a row lock on the orders table rather
 * than a counter in a process, because two processes with their own counters
 * would issue the same invoice number twice — and a GST series must be unique.
 */
export async function placeOrder(
  db: Database,
  input: PlaceOrderInput,
): Promise<{ ok: true; order: PlacedOrder } | { ok: false; message: string }> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const lines = await getCartLines(tx as unknown as Database, input.cartId);
    if (lines.length === 0) {
      return { ok: false as const, message: "Your bag is empty." };
    }

    // Lock every variant in the cart before checking stock, in a stable order
    // so two concurrent checkouts cannot deadlock against each other.
    const ids = [...lines.map((line) => line.variantId)].sort();
    for (const id of ids) {
      const locked = await tx.execute(
        sql`SELECT inventory FROM variants WHERE id = ${id} FOR UPDATE`,
      );
      const stock =
        (locked.rows[0] as { inventory: number } | undefined)?.inventory ?? 0;
      const wanted = lines.find((line) => line.variantId === id)!.quantity;
      if (wanted > stock) {
        const line = lines.find((l) => l.variantId === id)!;
        return {
          ok: false as const,
          message: `${line.title} — only ${stock} left.`,
        };
      }
    }

    const interState = isInterState(input.address.stateCode);
    const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
    const totals = calculateTotals(lines, {
      interState,
      shipping: shippingFor(subtotal),
      codFee: input.codFee ?? 0,
    });

    // Serialise number allocation across concurrent checkouts.
    await tx.execute(sql`LOCK TABLE orders IN SHARE ROW EXCLUSIVE MODE`);

    const seqRow = await tx.execute(
      sql`SELECT COALESCE(MAX(CAST(SUBSTRING(number FROM '[0-9]+$') AS integer)), 0) + 1 AS next FROM orders`,
    );
    const sequence = Number((seqRow.rows[0] as { next: number }).next);

    const fy = financialYear(now);
    const invoiceRow = await tx.execute(
      sql`SELECT COALESCE(MAX(invoice_sequence), 0) + 1 AS next FROM orders WHERE financial_year = ${fy}`,
    );
    const invoiceSeq = Number((invoiceRow.rows[0] as { next: number }).next);

    // An invoice is only raised for an order that is actually confirmed;
    // a held order must not burn a number out of a gapless series.
    const issueInvoice = input.status === "confirmed";

    const [order] = await tx
      .insert(orders)
      .values({
        number: buildOrderNumber(sequence),
        status: input.status,
        paymentMethod: input.paymentMethod,
        interState,
        address: input.address,
        subtotal: totals.subtotal,
        shipping: totals.shipping,
        codFee: totals.codFee,
        total: totals.total,
        taxableValue: totals.gst.taxableValue,
        cgst: totals.gst.cgst,
        sgst: totals.gst.sgst,
        igst: totals.gst.igst,
        eventId: input.eventId,
        placedAt: now,
        ...(input.customerId ? { customerId: input.customerId } : {}),
        phoneVerified: input.phoneVerified ?? false,
        ...(issueInvoice
          ? {
              invoiceNumber: invoiceNumber(invoiceSeq, now),
              invoiceSequence: invoiceSeq,
              financialYear: fy,
            }
          : {}),
      })
      .returning();

    await tx.insert(orderLines).values(
      lines.map((line) => ({
        orderId: order!.id,
        variantId: line.variantId,
        sku: line.sku,
        productHandle: line.productHandle,
        title: line.title,
        variantTitle: line.variantTitle,
        imageUrl: line.imageUrl,
        mrp: line.mrp,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        gstSlab: line.gstSlab,
        hsn: line.hsn,
        piercedJewellery: line.piercedJewellery,
      })),
    );

    // Stock leaves the moment the order exists, not when it ships. Anything
    // later oversells the window between the two.
    for (const line of lines) {
      await tx
        .update(variants)
        .set({ inventory: sql`${variants.inventory} - ${line.quantity}` })
        .where(eq(variants.id, line.variantId));
    }

    await tx.delete(cartLines).where(eq(cartLines.cartId, input.cartId));

    return {
      ok: true as const,
      order: {
        id: order!.id,
        number: order!.number,
        status: order!.status as OrderStatus,
        invoiceNumber: order!.invoiceNumber,
        accessKey: order!.accessKey,
      },
    };
  });
}

export interface RestockResult {
  readonly restocked: boolean;
  /** Units put back, by variant. Empty when the order had already been restocked. */
  readonly units: number;
  readonly reason?: "already_restocked" | "not_eligible";
}

/**
 * Put an order's goods back on the shelf.
 *
 * Idempotent by construction: the order row is locked and `restocked_at` is
 * checked inside the same transaction that writes it, so two operators clicking
 * at once — or a webhook racing a retry — cannot double-count the stock. A
 * boolean flag checked before the transaction would let both through.
 *
 * Only ended orders that owe stock qualify. Restocking a live order would sell
 * a piece that is in a box with someone's name on it.
 */
export async function restockOrder(
  db: Database,
  orderId: string,
  now: Date = new Date(),
): Promise<RestockResult> {
  return db.transaction(async (tx) => {
    const locked = await tx.execute(
      sql`SELECT status, restocked_at FROM orders WHERE id = ${orderId} FOR UPDATE`,
    );
    const row = locked.rows[0] as
      | { status: string; restocked_at: Date | null }
      | undefined;

    if (!row) return { restocked: false, units: 0, reason: "not_eligible" as const };
    if (row.restocked_at) {
      return { restocked: false, units: 0, reason: "already_restocked" as const };
    }
    if (!awaitsRestock(row.status as OrderStatus)) {
      return { restocked: false, units: 0, reason: "not_eligible" as const };
    }

    const lines = await tx
      .select()
      .from(orderLines)
      .where(eq(orderLines.orderId, orderId));

    // Sorted, like the checkout lock, so two restocks of overlapping orders
    // take the variant rows in the same order and cannot deadlock.
    const sorted = [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId));

    let units = 0;
    for (const line of sorted) {
      await tx
        .update(variants)
        .set({ inventory: sql`${variants.inventory} + ${line.quantity}` })
        .where(eq(variants.id, line.variantId));
      units += line.quantity;
    }

    await tx
      .update(orders)
      .set({ restockedAt: now })
      .where(eq(orders.id, orderId));

    return { restocked: true, units };
  });
}

/** Ended orders that still owe stock — the queue an operator works. */
export async function listAwaitingRestock(db: Database, limit = 100) {
  return db
    .select()
    .from(orders)
    .where(
      and(
        sql`${orders.restockedAt} IS NULL`,
        inArray(orders.status, ["rto", "returned", "cancelled"]),
      ),
    )
    .orderBy(desc(orders.placedAt))
    .limit(limit);
}

export async function getOrderByNumber(db: Database, number: string) {
  const [order] = await db.select().from(orders).where(eq(orders.number, number));
  if (!order) return undefined;

  const lines = await db
    .select()
    .from(orderLines)
    .where(eq(orderLines.orderId, order.id));

  return { ...order, lines };
}

export async function listOrders(db: Database, limit = 100) {
  return db.select().from(orders).orderBy(desc(orders.placedAt)).limit(limit);
}

/** One customer's orders, newest first. What the account page actually wants. */
export async function listOrdersForCustomer(
  db: Database,
  customerId: string,
  limit = 100,
) {
  return db
    .select()
    .from(orders)
    .where(eq(orders.customerId, customerId))
    .orderBy(desc(orders.placedAt))
    .limit(limit);
}

/**
 * Attach past guest orders to a customer who has now signed in.
 *
 * Matched on the delivery phone, which is the same number they just proved.
 * Without this, signing in makes a shopper's own order history disappear —
 * the orders are there, they are simply owned by nobody.
 */
export async function claimGuestOrders(
  db: Database,
  customerId: string,
  phone: string,
): Promise<number> {
  const claimed = await db
    .update(orders)
    .set({ customerId })
    .where(
      and(
        sql`${orders.customerId} IS NULL`,
        sql`${orders.address}->>'phone' = ${phone}`,
      ),
    )
    .returning({ id: orders.id });

  return claimed.length;
}
