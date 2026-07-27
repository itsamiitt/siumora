import "server-only";

import {
  canTransition,
  type CartLine,
  type Order,
  type OrderStatus,
  type PaymentMethod,
  type ShippingAddress,
} from "@siumora/core";

import { api } from "./api";
import { currentCartId } from "./cart-store";

/**
 * Orders.
 *
 * A thin adapter over the API. The domain shapes are unchanged, so the pages
 * that render orders did not have to move with the storage.
 */

/** Map an API order row onto the domain shape the pages already render. */
function toDomain(raw: Record<string, unknown>): Order {
  const lines = ((raw.lines as Array<Record<string, unknown>>) ?? []).map(
    (line): CartLine => ({
      variantId: line.variantId as string,
      sku: line.sku as string,
      productHandle: line.productHandle as string,
      title: line.title as string,
      variantTitle: line.variantTitle as string,
      imageUrl: line.imageUrl as string,
      mrp: line.mrp as number,
      unitPrice: line.unitPrice as number,
      quantity: line.quantity as number,
      gstSlab: line.gstSlab as CartLine["gstSlab"],
      hsn: line.hsn as string,
      piercedJewellery: Boolean(line.piercedJewellery),
    }),
  );

  const cgst = raw.cgst as number;
  const sgst = raw.sgst as number;
  const igst = raw.igst as number;
  const total = raw.total as number;

  return {
    id: raw.id as string,
    number: raw.number as string,
    status: raw.status as OrderStatus,
    lines,
    totals: {
      mrpTotal: lines.reduce((sum, l) => sum + l.mrp * l.quantity, 0),
      subtotal: raw.subtotal as number,
      savings:
        lines.reduce((sum, l) => sum + l.mrp * l.quantity, 0) -
        (raw.subtotal as number),
      shipping: raw.shipping as number,
      codFee: raw.codFee as number,
      total,
      gst: {
        taxableValue: raw.taxableValue as number,
        cgst,
        sgst,
        igst,
        totalTax: cgst + sgst + igst,
        total,
      },
      itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
    },
    paymentMethod: raw.paymentMethod as PaymentMethod,
    address: raw.address as ShippingAddress,
    interState: Boolean(raw.interState),
    placedAt: String(raw.placedAt),
    eventId: raw.eventId as string,
    ...(raw.deliveredAt ? { deliveredAt: String(raw.deliveredAt) } : {}),
    deliveryAttempts: (raw.deliveryAttempts as number) ?? 0,
    ...(raw.ndrReason ? { ndrReason: raw.ndrReason as Order["ndrReason"] } : {}),
    ...(raw.invoiceNumber ? { invoiceNumber: raw.invoiceNumber as string } : {}),
  };
}

export interface PlaceOrderInput {
  readonly address: ShippingAddress;
  readonly paymentMethod: PaymentMethod;
  readonly eventId: string;
  /** Sent so a retried submit cannot create a second order. */
  readonly idempotencyKey?: string;
}

export async function placeOrder(
  input: PlaceOrderInput,
): Promise<{ ok: true; orderNumber: string } | { ok: false; message: string }> {
  const cartId = await currentCartId();
  if (!cartId) return { ok: false, message: "Your bag is empty." };

  try {
    const result = await api().checkout(
      {
        cartId,
        address: input.address,
        paymentMethod: input.paymentMethod,
        eventId: input.eventId,
      },
      input.idempotencyKey,
    );
    return { ok: true, orderNumber: result.orderNumber };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error && error.message
          ? error.message
          : "Could not place the order.",
    };
  }
}

export async function getOrder(number: string): Promise<Order | undefined> {
  const result = await api().getOrder(number);
  return result ? toDomain(result.order) : undefined;
}

export async function confirmOrder(
  number: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    await api().confirmOrder(number);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

export async function advanceOrder(
  number: string,
  to: OrderStatus,
  ndrReason?: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    await api().advanceOrder(number, to, ndrReason);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

export async function resolveNdr(
  number: string,
  action: "reattempt" | "update_address" | "cancel",
): Promise<{ ok: boolean; message?: string }> {
  try {
    await api().answerNdr(number, action);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

/** The next states an order may legally move to. Drives the courier control. */
export function nextStatuses(status: OrderStatus): OrderStatus[] {
  return (
    [
      "confirmed",
      "processing",
      "shipped",
      "out_for_delivery",
      "delivered",
      "ndr",
      "rto",
      "cancelled",
      "returned",
    ] as OrderStatus[]
  ).filter((candidate) => canTransition(status, candidate));
}

/**
 * Orders for the account page.
 *
 * Reads the admin metrics feed, which is the only listing the API exposes.
 * Once sign-in exists this becomes a customer-scoped query instead.
 */
export async function listOrders(): Promise<Order[]> {
  const metrics = (await api().getMetrics()) as {
    recentOrders?: Array<Record<string, unknown>>;
  };
  return (metrics.recentOrders ?? []).map(toDomain);
}
