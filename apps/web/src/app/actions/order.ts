"use server";

import { revalidatePath } from "next/cache";

import type { PaymentMethod, ShippingAddress } from "@siumora/core";

import { forgetCart } from "@/lib/cart-store";
import {
  confirmOrder,
  finishPayment,
  placeOrder,
  type RazorpayHandoff,
} from "@/lib/order-store";

export interface PlaceOrderResult {
  ok: boolean;
  orderNumber?: string;
  message?: string;
  /** Machine-readable refusal: verify_phone, step_up_required, … */
  error?: string;
  /** Field-keyed problems with the address, when the backend names them. */
  fields?: Record<string, string>;
  /** Present when the browser should open the payment modal. */
  razorpay?: RazorpayHandoff;
  /**
   * Payment-first (Medusa): no order exists yet. Open the modal with
   * `razorpay`, then call completePayment with Checkout.js's proof.
   */
  payFirst?: boolean;
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
  /** The shopper's consent choice, recorded on the order for the server conversion. */
  consent?: "full" | "default";
  /** For the card in the parcel (plan 16 B21); the server tidies and bounds it. */
  giftMessage?: string;
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
    ...(input.consent ? { consent: input.consent } : {}),
    ...(input.giftMessage?.trim() ? { giftMessage: input.giftMessage.trim() } : {}),
  });
  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
      ...(result.error ? { error: result.error } : {}),
      ...(result.fields ? { fields: result.fields } : {}),
    };
  }

  // Payment-first: nothing is placed yet, and the bag stays exactly as it
  // is until the payment becomes an order — a closed modal loses nothing.
  if ("payFirst" in result) {
    return { ok: true, payFirst: true, razorpay: result.razorpay };
  }

  await letGoOfBag();
  return {
    ok: true,
    orderNumber: result.orderNumber,
    ...(result.razorpay ? { razorpay: result.razorpay } : {}),
  };
}

/**
 * The bag is let go only after the order exists, so a failure mid-flight
 * leaves the customer their bag rather than losing both. The backend has
 * already closed the cart; mutating it again would fail on Medusa.
 */
async function letGoOfBag(): Promise<void> {
  await forgetCart();
  // Only the pages that render the bag; the header count is client-side.
  revalidatePath("/cart");
  revalidatePath("/checkout");
}

/**
 * Place the order for a payment the shopper just made in Checkout.js
 * (payment-first). The same event id as the attempt rides as the
 * idempotency key, so a double-tap or a retry returns the one order.
 */
export async function completePayment(input: {
  paymentMethod: PaymentMethod;
  razorpay: { orderId: string; paymentId: string; signature: string };
  eventId: string;
}): Promise<PlaceOrderResult> {
  const result = await finishPayment({
    paymentMethod: input.paymentMethod,
    razorpay: input.razorpay,
    idempotencyKey: input.eventId,
  });
  if (!result.ok) {
    return { ok: false, message: result.message, ...(result.error ? { error: result.error } : {}) };
  }
  await letGoOfBag();
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
