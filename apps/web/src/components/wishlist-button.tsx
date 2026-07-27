"use client";

import { useState, useTransition } from "react";

import { mintEventId } from "@siumora/analytics";
import { track } from "@siumora/analytics/client";
import type { AnalyticsItem } from "@siumora/analytics";
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
  initiallySaved,
  item,
  value,
}: {
  handle: string;
  initiallySaved: boolean;
  item: AnalyticsItem;
  value: number;
}) {
  const [saved, setSaved] = useState(initiallySaved);
  const [pending, start] = useTransition();

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
      className="transition-colors hover:text-mulberry"
    >
      <MicroLabel tone={saved ? "mulberry" : "ink"}>
        {saved ? "Saved" : "Save for later"}
      </MicroLabel>
    </button>
  );
}
