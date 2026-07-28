"use server";

import type { CodDecision } from "@siumora/core";

import { api } from "@/lib/api";
import { currentCartId } from "@/lib/cart-store";
import { apiAs } from "@/lib/session";

/**
 * Checkout quote.
 *
 * The COD decision, the fee and the RTO band are all computed by the API from
 * the address as typed. Doing it in the browser would put the rules — and the
 * fee — somewhere a customer can edit them.
 */

export interface QuoteResult {
  serviceable: boolean;
  estimatedDays: string;
  addressQuality: { score: number; issues: string[]; needsReview: boolean };
  cod: CodDecision | null;
  /** True when the delivery number is the one this shopper signed in with. */
  phoneVerified: boolean;
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
    };
  } catch {
    // A quote failure must not block the page; the customer simply sees no
    // delivery promise rather than an error they cannot act on.
    return empty;
  }
}

/** Serviceability only, for the header pincode checker. */
export async function checkPincode(pincode: string): Promise<{
  serviceable: boolean;
  estimatedDays: string;
  codAvailable: boolean;
}> {
  try {
    const row = await api().getPincode(pincode);
    return {
      serviceable: row.serviceable,
      estimatedDays: row.estimatedDays,
      codAvailable: row.codAvailable,
    };
  } catch {
    return { serviceable: false, estimatedDays: "—", codAvailable: false };
  }
}
