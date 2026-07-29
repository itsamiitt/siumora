"use server";

import { revalidatePath } from "next/cache";

import type { PaymentMethod, ShippingAddress } from "@siumora/core";

import { clearCart } from "@/lib/cart-store";
import { confirmOrder, placeOrder, type RazorpayHandoff } from "@/lib/order-store";

export interface PlaceOrderResult {
  ok: boolean;
  orderNumber?: string;
  message?: string;
  /** Present when the browser should open the payment modal for this order. */
  razorpay?: RazorpayHandoff;
}

/**
 * Place an order.
 *
 * The `eventId` is minted by the caller and persisted on the order so the
 * browser `purchase` pixel and the later server-side send carry the same id and
 * dedupe into one conversion. Minting it here would give the two sends
 * different ids and double-count the revenue.
 */
export async function submitOrder(input: {
  address: ShippingAddress;
  paymentMethod: PaymentMethod;
  requiresCodConfirmation: boolean;
  eventId: string;
  codFee?: number;
  /**
   * Read from the browser's _ga cookie by the caller.
   *
   * It has to be captured here because the server has no other way to get it,
   * and GA4 refuses a server event without one — so without this the server
   * half of the dual-send never fires.
   */
  gaClientId?: string;
  /** A registered buyer GSTIN, for a B2B invoice. */
  buyerGstin?: string;
}): Promise<PlaceOrderResult> {
  // The event id doubles as the idempotency key: it is already unique per
  // checkout attempt and already travels with the order, so a resubmitted form
  // collides rather than placing a second order.
  const result = await placeOrder({
    address: input.address,
    paymentMethod: input.paymentMethod,
    eventId: input.eventId,
    idempotencyKey: input.eventId,
    ...(input.gaClientId ? { gaClientId: input.gaClientId } : {}),
    ...(input.buyerGstin ? { buyerGstin: input.buyerGstin } : {}),
  });
  if (!result.ok) return { ok: false, message: result.message };

  // The cart is emptied only after the order exists, so a failure mid-flight
  // leaves the customer their bag rather than losing both.
  await clearCart();
  revalidatePath("/cart");
  revalidatePath("/", "layout");

  return {
    ok: true,
    orderNumber: result.orderNumber,
    ...(result.razorpay ? { razorpay: result.razorpay } : {}),
  };
}

/**
 * Confirm a COD order that was held for verification.
 *
 * Stands in for the WhatsApp OTP callback; the state change is the same one
 * the webhook would drive.
 */
export async function confirmCodOrder(
  orderNumber: string,
): Promise<PlaceOrderResult> {
  const result = await confirmOrder(orderNumber);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(`/orders/${orderNumber}`);
  return { ok: true, orderNumber };
}
