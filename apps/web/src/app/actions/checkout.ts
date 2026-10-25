"use server";

import {
  calculateTotals,
  isInterState,
  shippingFor,
  type CodDecision,
} from "@siumora/core";
import { ApiError, type QuotedTotals } from "@siumora/sdk";

import { api } from "@/lib/api";
import { currentCartId, getCartLines } from "@/lib/cart-store";
import { apiAs } from "@/lib/session";

/**
 * Checkout quote.
 *
 * The COD decision, the fee and the RTO band are all computed by the API from
 * the address as typed. Doing it in the browser would put the rules — and the
 * fee — somewhere a customer can edit them. The totals come from the server
 * too (plan 16 R6): the summary and the Pay label show exactly these.
 */

export interface QuoteResult {
  serviceable: boolean;
  estimatedDays: string;
  addressQuality: { score: number; issues: string[]; needsReview: boolean };
  cod: CodDecision | null;
  /** True when the delivery number is the one this shopper signed in with. */
  phoneVerified: boolean;
  /** Choosing COD will ask to verify this number first. */
  codNeedsVerification: boolean;
  /** What the order will carry, per method. Null when it cannot be priced. */
  totals: { prepaid: QuotedTotals; cod: QuotedTotals | null; interState: boolean } | null;
  /** Fingerprint of the bag; a change means the prices moved. */
  cartVersion: string | null;
  /** Coupon codes on the cart (plan 16 B19). */
  coupons: string[];
}

/**
 * Totals for a backend whose quote does not carry them (the frozen Fastify
 * path): the same core engine, still computed here on the server.
 */
async function serverTotals(stateCode: string | undefined, cod: CodDecision | null) {
  const lines = await getCartLines();
  if (lines.length === 0) return null;
  const interState = stateCode ? isInterState(stateCode) : false;
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity - (line.discount ?? 0), 0);
  const shape = (codFee: number): QuotedTotals => {
    const totals = calculateTotals(lines, { interState, shipping: shippingFor(subtotal), codFee });
    return {
      subtotal: totals.subtotal,
      discount: totals.discount,
      shipping: totals.shipping,
      codFee: totals.codFee,
      total: totals.total,
      gst: {
        taxableValue: totals.gst.taxableValue,
        cgst: totals.gst.cgst,
        sgst: totals.gst.sgst,
        igst: totals.gst.igst,
      },
    };
  };
  return { prepaid: shape(0), cod: cod?.available ? shape(cod.fee) : null, interState };
}

export async function quoteCheckout(input: {
  pincode: string;
  address?: string;
  city?: string;
  stateCode?: string;
  phone?: string;
}): Promise<QuoteResult> {
  const cartId = await currentCartId();

  const empty: QuoteResult = {
    serviceable: false,
    estimatedDays: "—",
    addressQuality: { score: 0, issues: [], needsReview: false },
    cod: null,
    phoneVerified: false,
    codNeedsVerification: false,
    totals: null,
    cartVersion: null,
    coupons: [],
  };

  if (!cartId) return empty;

  try {
    // Sent as the signed-in shopper when there is one: a proven number lowers
    // the RTO score, and a repeat buyer stops paying the COD fee.
    const quote = await (await apiAs()).quoteCheckout({ cartId, ...input });
    return {
      serviceable: quote.serviceable,
      estimatedDays: quote.estimatedDays,
      addressQuality: quote.addressQuality,
      cod: quote.cod,
      phoneVerified: quote.phoneVerified,
      codNeedsVerification: quote.codNeedsVerification ?? false,
      totals: quote.totals !== undefined ? quote.totals : await serverTotals(input.stateCode, quote.cod),
      cartVersion: quote.cartVersion ?? null,
      coupons: quote.coupons ?? [],
    };
  } catch {
    // A quote failure must not block the page; the customer simply sees no
    // delivery promise rather than an error they cannot act on.
    return empty;
  }
}

/** Serviceability, plus the city and state to fill in, for the pincode. */
export async function checkPincode(pincode: string): Promise<{
  serviceable: boolean;
  estimatedDays: string;
  codAvailable: boolean;
  city?: string;
  stateCode?: string;
}> {
  try {
    const row = await api().getPincode(pincode);
    return {
      serviceable: row.serviceable,
      estimatedDays: row.estimatedDays,
      codAvailable: row.codAvailable,
      ...(row.city ? { city: row.city } : {}),
      ...(row.stateCode ? { stateCode: row.stateCode } : {}),
    };
  } catch {
    return { serviceable: false, estimatedDays: "—", codAvailable: false };
  }
}

export type CouponResult =
  | { ok: true; coupons: string[]; discount: number }
  | { ok: false; message: string };

/**
 * Apply or remove a coupon (plan 16 B19). The server decides what a code is
 * worth — Medusa's Promotions — and says plainly when a code is unknown or
 * does not fit this bag; the page re-reads the cart and re-quotes after.
 */
export async function applyCoupon(code: string): Promise<CouponResult> {
  return couponCall((client, cartId) => client.applyCoupon(cartId, code.trim()));
}

export async function removeCoupon(code: string): Promise<CouponResult> {
  return couponCall((client, cartId) => client.removeCoupon(cartId, code));
}

async function couponCall(
  call: (client: Awaited<ReturnType<typeof apiAs>>, cartId: string) => Promise<{ coupons: string[]; discount: number }>,
): Promise<CouponResult> {
  const cartId = await currentCartId();
  if (!cartId) return { ok: false, message: "Your bag is empty." };
  try {
    const state = await call(await apiAs(), cartId);
    return { ok: true, coupons: state.coupons, discount: state.discount };
  } catch (error) {
    if (error instanceof ApiError && error.status === 429) {
      return { ok: false, message: "Too many tries — wait a minute and try again." };
    }
    if (error instanceof ApiError && error.status < 500) return { ok: false, message: error.message };
    return { ok: false, message: "We couldn't check that code just now. Try again." };
  }
}

/**
 * The cart-reminder choice from step 1 (plan 16 B22): ticked records this
 * number for one WhatsApp if the shopper leaves; unticked withdraws it.
 * Best effort — a failure here must never get in the way of checking out.
 */
export async function saveReminderChoice(phone: string, consent: boolean): Promise<void> {
  const cartId = await currentCartId();
  if (!cartId) return;
  try {
    await (await apiAs()).setCartReminders(cartId, { phone, consent });
  } catch {
    // Nothing to tell the shopper: at worst, no reminder.
  }
}
