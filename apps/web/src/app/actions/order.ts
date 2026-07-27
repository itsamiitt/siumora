"use server";

import { revalidatePath } from "next/cache";

import type { PaymentMethod, ShippingAddress } from "@siumora/core";

import { clearCart } from "@/lib/cart-store";
import { confirmOrder, placeOrder } from "@/lib/order-store";

export interface PlaceOrderResult {
  ok: boolean;
  orderNumber?: string;
  message?: string;
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
}): Promise<PlaceOrderResult> {
  // The event id doubles as the idempotency key: it is already unique per
  // checkout attempt and already travels with the order, so a resubmitted form
  // collides rather than placing a second order.
  const result = await placeOrder({
    address: input.address,
    paymentMethod: input.paymentMethod,
    eventId: input.eventId,
    idempotencyKey: input.eventId,
  });
  if (!result.ok) return { ok: false, message: result.message };

  // The cart is emptied only after the order exists, so a failure mid-flight
  // leaves the customer their bag rather than losing both.
  await clearCart();
  revalidatePath("/cart");
  revalidatePath("/", "layout");

  return { ok: true, orderNumber: result.orderNumber };
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
