"use client";

import { useEffect, useState, useTransition } from "react";

import {
  track,
  mintEventId,
  type AnalyticsItem,
} from "@siumora/analytics/client";
import { MicroLabel } from "@siumora/ui";

import { toggleWishlistItem } from "@/app/actions/wishlist";

/** The saved state is read after hydration so the product page stays cacheable. */
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
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [pending, start] = useTransition();

  useEffect(() => {
    const controller = new AbortController();
    setReady(false);
    setMessage(null);

    void (async () => {
      try {
        const response = await fetch("/api/wishlist", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Could not load Saved.");
        const data = (await response.json()) as { handles: string[] };
        setSaved(data.handles.includes(handle));
        setReady(true);
      } catch {
        if (!controller.signal.aborted) {
          setMessage("Saved items are unavailable right now.");
        }
      }
    })();

    return () => controller.abort();
  }, [handle, retry]);

  return (
    <div>
      <button
        type="button"
        aria-pressed={ready ? saved : undefined}
        disabled={!ready || pending}
        onClick={() =>
          start(async () => {
            const next = !saved;
            setSaved(next);
            setMessage(null);
            try {
              const result = await toggleWishlistItem(handle);
              setSaved(result.wishlisted);
              if (result.wishlisted) {
                try {
                  track("add_to_wishlist", {
                    event_id: mintEventId(),
                    currency: "INR",
                    value,
                    items: [item],
                  });
                } catch {
                  // Analytics must never change the result of a saved-item write.
                }
              }
            } catch {
              setSaved(saved);
              setMessage("Could not update Saved. Please try again.");
            }
          })
        }
        className="min-h-11 transition-colors hover:text-accent-ink disabled:opacity-60"
      >
        <MicroLabel tone={saved ? "mulberry" : "ink"}>
          {!ready ? "Checking Saved…" : saved ? "Saved" : "Save for later"}
        </MicroLabel>
      </button>
      {message && (
        <p role="alert" className="mt-2 text-xs text-content-muted">
          {message}{" "}
          {!ready && (
            <button
              type="button"
              onClick={() => setRetry((count) => count + 1)}
              className="underline underline-offset-4"
            >
              Retry
            </button>
          )}
        </p>
      )}
    </div>
  );
}
