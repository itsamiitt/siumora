import "server-only";

import {
  canTransition,
  type CartLine,
  type Order,
  type OrderStatus,
  type PaymentMethod,
  type ShippingAddress,
} from "@siumora/core";

import { currentCartId } from "./cart-store";
import { apiAs, orderAccessKey, rememberOrderKey } from "./session";

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
    ...(raw.buyerGstin ? { buyerGstin: raw.buyerGstin as string } : {}),
  };
}

export interface PlaceOrderInput {
  readonly address: ShippingAddress;
  readonly paymentMethod: PaymentMethod;
  readonly eventId: string;
  /** Sent so a retried submit cannot create a second order. */
  readonly idempotencyKey?: string;
  /** The browser GA4 client id, without which no server-side GA4 event can go. */
  readonly gaClientId?: string;
  /** A registered buyer GSTIN, for a B2B invoice. */
  readonly buyerGstin?: string;
}

export async function placeOrder(
  input: PlaceOrderInput,
): Promise<{ ok: true; orderNumber: string } | { ok: false; message: string }> {
  const cartId = await currentCartId();
  if (!cartId) return { ok: false, message: "Your bag is empty." };

  try {
    const result = await (await apiAs()).checkout(
      {
        cartId,
        address: input.address,
        paymentMethod: input.paymentMethod,
        eventId: input.eventId,
        ...(input.gaClientId ? { gaClientId: input.gaClientId } : {}),
        ...(input.buyerGstin ? { buyerGstin: input.buyerGstin } : {}),
      },
      input.idempotencyKey,
    );

    // Kept so this browser can reopen the order later. A signed-in customer
    // does not need it, but they may have placed this one as a guest.
    await rememberOrderKey(result.orderNumber, result.accessKey);

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
  const result = await (await apiAs()).getOrder(number, await orderAccessKey(number));
  return result ? toDomain(result.order) : undefined;
}

export async function confirmOrder(
  number: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    await (await apiAs()).confirmOrder(number, await orderAccessKey(number));
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
    await (await apiAs()).advanceOrder(
      number,
      to,
      ndrReason,
      await orderAccessKey(number),
    );
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
    await (await apiAs()).answerNdr(number, action, await orderAccessKey(number));
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
 * The signed-in customer's own orders.
 *
 * Returns nothing when nobody is signed in, rather than falling back to a
 * wider listing: an account page that shows other people's orders is worse
 * than an empty one.
 */
export async function listOrders(): Promise<Order[]> {
  try {
    const rows = await (await apiAs()).listOrders();
    return rows.map(toDomain);
  } catch {
    return [];
  }
}

/**
 * Every recent order, for the ops dashboard.
 *
 * Reads the metrics endpoint, which the API serves only to a signed-in
 * operator. A caller who is not one gets nothing rather than a partial view.
 */
export async function listAllOrders(): Promise<Order[]> {
  try {
    const metrics = (await (await apiAs()).getMetrics()) as {
      recentOrders?: Array<Record<string, unknown>>;
    };
    return (metrics.recentOrders ?? []).map(toDomain);
  } catch {
    return [];
  }
}

export interface TrackingReport {
  readonly health: {
    pending: number;
    sent: number;
    failed: number;
    skipped: number;
  };
  readonly missingConversions: Array<{ number: string; status: string }>;
}

/**
 * Order-to-conversion parity, for the ops dashboard.
 *
 * Doc 08 §8 asks for this to be watched rather than assumed: a gap between
 * orders and conversions is revenue the ad platforms cannot see, and it drifts
 * silently — nothing breaks, the numbers just quietly stop matching.
 */
export async function getTrackingReport(): Promise<TrackingReport | undefined> {
  try {
    const metrics = (await (await apiAs()).getMetrics()) as {
      tracking?: TrackingReport;
    };
    return metrics.tracking;
  } catch {
    return undefined;
  }
}

export interface RemittanceReport {
  readonly batches: Array<{
    batchId: string;
    courier: string;
    rows: number;
    collected: number;
    deductions: number;
    remitted: number;
    shortfall: number;
    exceptions: number;
  }>;
  readonly exceptions: Array<{
    id: string;
    orderNumber: string;
    outcome: string;
    variance: number;
    note: string | null;
  }>;
  readonly cash: {
    prepaidSettled: number;
    codInTransit: number;
    codAwaitingRemittance: number;
    codRemitted: number;
  };
}

/**
 * COD remittances, for the ops dashboard.
 *
 * The distinction the panel exists to draw is between cash the shop has and
 * cash a courier is holding: COD delivered but not remitted is revenue on the
 * books and nothing in the bank.
 */
export async function getRemittanceReport(): Promise<
  RemittanceReport | undefined
> {
  try {
    return (await (await apiAs()).getRemittanceReport()) as unknown as RemittanceReport;
  } catch {
    return undefined;
  }
}
