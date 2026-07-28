"use client";

import { useEffect } from "react";

import { track, toRupees } from "@siumora/analytics/client";
import type { Order } from "@siumora/core";

/**
 * Fires `purchase` once per order.
 *
 * Uses the `event_id` persisted on the order, not a fresh one, so this browser
 * send and the later server-side Conversions API send collapse into a single
 * conversion. A new id here would double-count the revenue.
 *
 * Guarded by sessionStorage: a refresh of the confirmation page must not
 * report a second sale.
 */
export function TrackPurchase({ order }: { order: Order }) {
  useEffect(() => {
    const key = `siumora.purchase.${order.number}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Storage unavailable — better to risk a duplicate than lose the event.
    }

    track("purchase", {
      event_id: order.eventId,
      transaction_id: order.number,
      currency: "INR",
      value: toRupees(order.totals.total),
      tax: toRupees(order.totals.gst.totalTax),
      shipping: toRupees(order.totals.shipping),
      items: order.lines.map((line) => ({
        item_id: line.sku,
        item_name: line.title,
        price: toRupees(line.unitPrice),
        quantity: line.quantity,
        item_variant: line.variantTitle,
        item_brand: "Siumora",
      })),
    });
  }, [order]);

  return null;
}
