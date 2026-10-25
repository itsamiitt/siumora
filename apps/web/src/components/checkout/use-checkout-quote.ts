"use client";

import { useEffect, useRef, useState } from "react";

import { isValidPincode } from "@siumora/in-locale";

import { quoteCheckout, type QuoteResult } from "@/app/actions/checkout";

/**
 * The live quote — delivery promise, COD terms and the totals — for what the
 * shopper has typed (plan 16 Phase C).
 *
 * Debounced, so a pause in typing asks once instead of every keystroke
 * asking (and COD flickering while the address is half-written). A newer
 * request always wins: an older answer arriving late is dropped rather than
 * overwriting the current one.
 */
const DEBOUNCE_MS = 400;

export function useCheckoutQuote(input: {
  pincode: string;
  address: string;
  city: string;
  stateCode: string;
  phone: string;
  /** Bumped when something the address does not show changed — a coupon. */
  refresh?: number;
}): { quote: QuoteResult | null; loading: boolean } {
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);
  const { pincode, address, city, stateCode, phone, refresh = 0 } = input;

  useEffect(() => {
    if (!isValidPincode(pincode)) {
      latest.current += 1;
      setQuote(null);
      setLoading(false);
      return;
    }
    const id = ++latest.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void quoteCheckout({
        pincode,
        address,
        city,
        // Only once chosen — an empty string is not a state code, and the
        // API says so with a 400.
        ...(stateCode ? { stateCode } : {}),
        // Sent so the API can tell whether this is the number the shopper
        // proved at sign-in — a verified number changes the COD terms.
        phone,
      }).then((next) => {
        if (id !== latest.current) return;
        setQuote(next);
        setLoading(false);
      });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [pincode, address, city, stateCode, phone, refresh]);

  return { quote, loading };
}
