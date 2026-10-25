"use client";

import { useEffect } from "react";

import { mintEventId, track } from "@siumora/analytics/client";
import type { CartLine } from "@siumora/core";

import { analyticsItems } from "@/lib/checkout-rules";

/**
 * Fires `view_cart` once per bag-page mount (plan 16 Phase D) — the funnel
 * step between add_to_cart and begin_checkout that plan/08 names and nothing
 * sent before. A client component for the same reason as TrackViewItem: the
 * browser holds the GA4 client id and the Meta cookies.
 */
export function TrackViewCart({ lines, value }: { lines: CartLine[]; value: number }) {
  useEffect(() => {
    if (lines.length === 0) return;
    track("view_cart", {
      event_id: mintEventId(),
      currency: "INR",
      value: value / 100,
      items: analyticsItems(lines),
    });
    // Mount-only: re-firing on every quantity change would inflate the count.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
