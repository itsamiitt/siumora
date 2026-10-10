import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { findInvoiceByOrderId, type GstSqlClient } from "../modules/gst/allocate";
import { invoiceCard } from "../modules/gst/invoice";
import {
  findOpenReturn,
  getStatusRow,
  type SqlClient as StatusSqlClient,
} from "../modules/returns-ndr/data";
import { returnEnvelope } from "../modules/returns-ndr/lifecycle";
import {
  linePaise,
  majorToPaise,
  siumoraOrderStatus,
  wireNumber,
  type OrderLineWire,
} from "../modules/siumora-order/identity";

/**
 * The customer-facing order card — the body of GET
 * /store/siumora/orders/:number, shared with the signed-in order list
 * (auth plan phase 2) so the two can never disagree about an order.
 */

export const ORDER_FIELDS = [
  "id",
  "status",
  "email",
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
];

export interface OrderWire {
  id: string;
  status: string;
  email?: string | null;
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

export async function fetchOrders(
  scope: MedusaContainer,
  orderIds: readonly string[],
): Promise<Map<string, OrderWire>> {
  if (orderIds.length === 0) return new Map();
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "order",
    fields: ORDER_FIELDS,
    filters: { id: [...orderIds] },
  });
  return new Map((data as OrderWire[]).map((order) => [order.id, order]));
}

export interface OrderCardLine {
  variantId: string;
  sku: string;
  productHandle: string;
  title: string;
  variantTitle: string;
  imageUrl: string;
  mrp: number;
  unitPrice: number;
  quantity: number;
  gstSlab: number | null;
  hsn: string;
  piercedJewellery: boolean;
}

export function orderLines(order: OrderWire): OrderCardLine[] {
  return (order.items ?? []).filter(Boolean).map((item) => {
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
      gstSlab: typeof productMetadata.gst_slab === "number" ? productMetadata.gst_slab : null,
      hsn: typeof productMetadata.hsn === "string" ? productMetadata.hsn : "",
      piercedJewellery: productMetadata.pierced_jewellery === true,
    };
  });
}

export async function orderCard(
  scope: MedusaContainer,
  identity: { order_id: string; order_number: string },
  order: OrderWire,
) {
  const pgConnection = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const lines = orderLines(order);

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

  // The status truth (M2 wave B row 8): once returns-ndr has touched the
  // order its row IS the status — walked transitions and NDR show on the
  // card. A fresh order has no row yet and keeps the same confirmed-unless-
  // cancelled mapping the row would be seeded from. Read-only on purpose:
  // a guest read must not create rows (the write routes ensure lazily).
  const statusPg = pgConnection as unknown as StatusSqlClient;
  const [statusRow, openReturn] = await Promise.all([
    getStatusRow(statusPg, identity.order_id),
    findOpenReturn(statusPg, identity.order_id),
  ]);

  return {
    order: {
      id: order.id,
      number: identity.order_number,
      status: statusRow?.status ?? siumoraOrderStatus(order.status),
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
    // The open return, when one exists — the same inner shape the
    // requestReturn envelope serves, so the card and the request agree.
    return: openReturn ? returnEnvelope(openReturn).return : null,
  };
}
