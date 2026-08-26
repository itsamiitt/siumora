// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { calculateTotals, isInterState, type CartLine, type Order, type OrderStatus, type ShippingAddress } from "@siumora/core";

import {
  linePaise,
  majorToPaise,
  wireNumber,
  type OrderLineWire,
} from "../modules/siumora-order/identity.ts";
import { initialSiumoraStatus } from "../modules/returns-ndr/lifecycle.ts";

/**
 * Pure assembly of core's domain Order from Medusa wire shapes — the Medusa
 * twin of the Fastify admin route's toDomainOrder (apps/api/src/routes/
 * admin.ts), shared by the M2 ops routes (metrics, gstr1, remittances,
 * cash-position) so they all describe the same order the same way.
 *
 * No Medusa imports: node --test strip-types this file. The I/O half that
 * fetches the wire shapes lives in domain-orders.ts.
 */

/** One order item as query.graph returns it (order read route's shape). */
export type ItemWire = OrderLineWire & {
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
};

export interface OrderWire {
  id: string;
  status: string;
  created_at: string | Date;
  /** BigNumber on the wire — unwrap through wireNumber, never arithmetic. */
  shipping_total: unknown;
  shipping_address?: Record<string, unknown> | null;
  items?: Array<ItemWire | null> | null;
}

export interface OrderSidecars {
  /** SIU order number from siumora_order_identity. */
  orderNumber: string;
  /** siumora_order_status row, when one exists — the status truth. */
  statusRow?: { status: string; ndr_reason: string | null } | undefined;
  /** Failed delivery attempts (count of siumora_ndr_events rows). */
  ndrAttempts: number;
  /** gst_invoice row fields, when the order has been invoiced. */
  invoice?: { invoice_number: string; buyer_gstin: string | null } | undefined;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Reverse of the transport's shipping_address write (stateCode rides
 * province, pincode rides postal_code — packages/sdk/src/medusa.ts). */
export function toShippingAddress(
  wire: Record<string, unknown> | null | undefined,
): ShippingAddress {
  const first = str(wire?.first_name);
  const last = str(wire?.last_name);
  return {
    name: [first, last].filter(Boolean).join(" "),
    phone: str(wire?.phone),
    line1: str(wire?.address_1),
    ...(str(wire?.address_2) ? { line2: str(wire?.address_2) } : {}),
    city: str(wire?.city),
    stateCode: str(wire?.province),
    pincode: str(wire?.postal_code),
  };
}

export function toCartLines(wire: OrderWire): CartLine[] {
  return (wire.items ?? []).filter(Boolean).map((item) => {
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
      // 5 is the jewellery slab every seeded product carries — the honest
      // default for a product whose metadata predates the India-fields
      // widget, not a policy.
      gstSlab:
        typeof productMetadata.gst_slab === "number"
          ? (productMetadata.gst_slab as CartLine["gstSlab"])
          : (5 as CartLine["gstSlab"]),
      hsn: typeof productMetadata.hsn === "string" ? productMetadata.hsn : "",
      piercedJewellery: productMetadata.pierced_jewellery === true,
    };
  });
}

/**
 * Assemble the domain Order. Status comes from the status row when one
 * exists (the row IS the truth once returns-ndr touched the order), else the
 * same confirmed-unless-cancelled mapping every fresh order starts from.
 */
export function toDomainOrder(wire: OrderWire, sidecars: OrderSidecars): Order {
  const lines = toCartLines(wire);
  const address = toShippingAddress(wire.shipping_address);
  const interState = isInterState(address.stateCode);
  const shipping = majorToPaise(wireNumber(wire.shipping_total, "shipping_total"));
  const status = (sidecars.statusRow?.status ??
    initialSiumoraStatus(wire.status)) as OrderStatus;
  const ndrReason = sidecars.statusRow?.ndr_reason ?? null;

  return {
    id: wire.id,
    number: sidecars.orderNumber,
    status,
    lines,
    totals: calculateTotals(lines, { interState, shipping, codFee: 0 }),
    paymentMethod: "cod",
    address,
    interState,
    placedAt: new Date(wire.created_at).toISOString(),
    // No analytics outbox on this stack yet (M2 wave B outbox port); the
    // order id is a stable stand-in, never served to a tag.
    eventId: wire.id,
    deliveryAttempts: sidecars.ndrAttempts,
    ...(ndrReason ? { ndrReason: ndrReason as Order["ndrReason"] } : {}),
    ...(sidecars.invoice ? { invoiceNumber: sidecars.invoice.invoice_number } : {}),
    ...(sidecars.invoice?.buyer_gstin
      ? { buyerGstin: sidecars.invoice.buyer_gstin }
      : {}),
  };
}
