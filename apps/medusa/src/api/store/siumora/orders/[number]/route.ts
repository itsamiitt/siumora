import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import {
  findInvoiceByOrderId,
  type GstSqlClient,
} from "../../../../../modules/gst/allocate";
import { invoiceCard } from "../../../../../modules/gst/invoice";
import {
  findIdentityByNumber,
  type SqlClient,
} from "../../../../../modules/siumora-order/allocate";
import {
  isWellFormedAccessKey,
  linePaise,
  majorToPaise,
  siumoraOrderStatus,
  wireNumber,
  type OrderLineWire,
} from "../../../../../modules/siumora-order/identity";

/**
 * GET /store/siumora/orders/:number?key=<uuid> — the guest order read.
 *
 * The recorded contract (apps/api/src/sdk-contract.test.ts, getOrder):
 * - a MALFORMED key (not a uuid) is a 400 invalid_request — the caller's
 *   client is broken, tell it so;
 * - NO key, a wrong-but-well-formed key, or an unknown number are all the
 *   same 404 not_found — never a 403, because a 403 would confirm the order
 *   number is real, which is exactly what an enumeration walk is after
 *   (order numbers are a readable sequence; the key is the credential);
 * - the correct key gets the card { order, invoice, return }.
 *
 * invoice is the STORED statutory card — { rows, totals } off the gst
 * module's gst_invoice row, the same core hsnSummary/summariseInvoice
 * shapes the Fastify card carries — and order.invoiceNumber is that row's
 * number. Served from the row rather than recomputed so the customer sees
 * the invoice that was actually issued. Orders that predate the gst module
 * (SIU-00001) have no row: invoice stays null and invoiceNumber stays null,
 * which the recorded contract allows — the read must not 500 on them.
 * return is null (returns are the M2 returns-ndr module). The order carries
 * the same field names the Fastify order row uses, with all money in
 * integer paise read the way the transport reads it (variant metadata
 * price_paise/mrp_paise first).
 *
 * A signed-in owner needs no key on the Fastify side; here the same grant
 * activates when Medusa's customer auth populates req.auth_context (the
 * phone-OTP auth provider is its own M1 work item) — the actor id IS the
 * customer id for actor_type "customer".
 */

interface OrderWire {
  id: string;
  status: string;
  created_at: string | Date;
  customer_id: string | null;
  /** BigNumber on the wire — unwrap through wireNumber, never arithmetic. */
  shipping_total: unknown;
  shipping_address?: Record<string, unknown> | null;
  items?: Array<
    | (OrderLineWire & {
        id: string;
        title: string | null;
        product_title: string | null;
        product_handle: string | null;
        variant_id: string | null;
        variant_sku: string | null;
        variant_title: string | null;
        thumbnail: string | null;
        variant?: {
          id: string;
          metadata?: Record<string, unknown> | null;
          product?: { metadata?: Record<string, unknown> | null } | null;
        } | null;
      })
    | null
  > | null;
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const number = req.params.number!;
  const rawKey = req.query.key;
  const key = typeof rawKey === "string" ? rawKey : undefined;

  // Malformed key: the 400 arm. Shaped like the Fastify zod-failure 400s.
  if ((rawKey !== undefined && typeof rawKey !== "string") ||
      (key !== undefined && !isWellFormedAccessKey(key))) {
    res.status(400).json({
      error: "invalid_request",
      message: "key: expected a UUID access key",
    });
    return;
  }

  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const pg = pgConnection as unknown as SqlClient;
  const identity = await findIdentityByNumber(pg, number);
  if (!identity) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "status",
      "created_at",
      "customer_id",
      "shipping_total",
      "shipping_address.*",
      // items.* rather than a field list: quantity is a computed field that
      // resolves undefined when named explicitly (probed on 2.18.0).
      "items.*",
      "items.variant.id",
      "items.variant.metadata",
      "items.variant.product.metadata",
    ],
    filters: { id: identity.order_id },
  });
  const order = orders[0] as OrderWire | undefined;
  if (!order) {
    // An identity without its order — allocation ran but the order vanished.
    // To a guest that is indistinguishable from "no such order".
    res.status(404).json({ error: "not_found" });
    return;
  }

  // Owning the order (session) or holding the key issued at checkout — the
  // same two grants the Fastify route honours. Everything else: 404.
  const actorId = (req as { auth_context?: { actor_id?: string } }).auth_context
    ?.actor_id;
  const isOwner = Boolean(actorId && order.customer_id && actorId === order.customer_id);
  const holdsKey = key !== undefined && key === identity.access_key;
  if (!isOwner && !holdsKey) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const lines = (order.items ?? []).filter(Boolean).map((item) => {
    const paise = linePaise(item!);
    const productMetadata = item!.variant?.product?.metadata ?? {};
    return {
      variantId: item!.variant_id ?? item!.variant?.id ?? "",
      sku: item!.variant_sku ?? "",
      productHandle: item!.product_handle ?? "",
      title: item!.product_title ?? item!.title ?? "",
      variantTitle: item!.variant_title ?? "",
      imageUrl: item!.thumbnail ?? "",
      mrp: paise.mrp,
      unitPrice: paise.unitPrice,
      quantity: wireNumber(item!.quantity, "quantity"),
      gstSlab:
        typeof productMetadata.gst_slab === "number" ? productMetadata.gst_slab : null,
      hsn: typeof productMetadata.hsn === "string" ? productMetadata.hsn : "",
      piercedJewellery: productMetadata.pierced_jewellery === true,
    };
  });

  // Integer paise throughout: line money from the lossless metadata channel,
  // shipping from Medusa majors through the refusing converter. Never floats.
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const shipping = majorToPaise(wireNumber(order.shipping_total, "shipping_total"));
  const codFee = 0;

  // The stored statutory invoice (M2 gst module). Absent for orders that
  // predate the module — invoice and invoiceNumber honestly null, no 500.
  const invoiceRow = await findInvoiceByOrderId(
    pgConnection as unknown as GstSqlClient,
    identity.order_id,
  );

  res.setHeader("Cache-Control", "no-store");
  res.json({
    order: {
      id: order.id,
      number: identity.order_number,
      status: siumoraOrderStatus(order.status),
      paymentMethod: "cod",
      placedAt: order.created_at,
      address: order.shipping_address ?? null,
      subtotal,
      shipping,
      codFee,
      total: subtotal + shipping + codFee,
      invoiceNumber: invoiceRow?.invoice_number ?? null,
      lines,
    },
    invoice: invoiceRow ? invoiceCard(invoiceRow) : null,
    return: null,
  });
}
