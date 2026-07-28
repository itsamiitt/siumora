"use client";

import { useEffect, useState, useTransition } from "react";

import {
  track,
  mintEventId,
  type AnalyticsItem,
} from "@siumora/analytics/client";
import { MicroLabel } from "@siumora/ui";

import { toggleWishlistItem } from "@/app/actions/wishlist";

/**
 * Save for later.
 *
 * Optimistic: the label flips immediately and reconciles from the action's
 * return value. `add_to_wishlist` fires only on the add, never on the remove —
 * an un-save is not a signal any ad platform should optimise toward.
 */
export function WishlistButton({
  handle,
  item,
  value,
}: {
  handle: string;
  item: AnalyticsItem;
  value: number;
}) {
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  // Resolved after hydration rather than during render. Reading the wishlist
  // cookie on the server would make the product page dynamic and drop it out
  // of the static tier, which is where the LCP budget lives.
  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch("/api/wishlist", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = (await response.json()) as { handles: string[] };
        setSaved(data.handles.includes(handle));
      } catch {
        // Offline or aborted — the button still works, it just starts unsaved.
      }
    })();

    return () => controller.abort();
  }, [handle]);

  return (
    <button
      type="button"
      aria-pressed={saved}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const next = !saved;
          setSaved(next);

          const result = await toggleWishlistItem(handle);
          setSaved(result.wishlisted);

          if (result.wishlisted) {
            track("add_to_wishlist", {
              event_id: mintEventId(),
              currency: "INR",
              value,
              items: [item],
            });
          }
        })
      }
      className="transition-colors hover:text-accent-ink"
    >
      <MicroLabel tone={saved ? "mulberry" : "ink"}>
        {saved ? "Saved" : "Save for later"}
      </MicroLabel>
    </button>
  );
}
