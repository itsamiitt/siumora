"use client";

import { useEffect } from "react";

import { track, mintEventId, type AnalyticsItem } from "@siumora/analytics/client";

/**
 * Fires `view_item` once per PDP mount.
 *
 * A client component rather than a server call because GA4 needs the browser
 * client_id and Meta needs fbp/fbc — neither exists server-side. Rendering it
 * beside the product keeps the PDP itself a server component.
 */
export function TrackViewItem({
  item,
  value,
}: {
  item: AnalyticsItem;
  value: number;
}) {
  useEffect(() => {
    track("view_item", {
      event_id: mintEventId(),
      currency: "INR",
      value,
      items: [item],
    });
    // Deliberately mount-only: re-firing on every render would inflate the
    // event count and skew every funnel built on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
