"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { MicroLabel } from "@siumora/ui";

/** Dispatched after any cart mutation, carrying the authoritative new count. */
export const CART_CHANGED_EVENT = "siumora:cart-changed";

export function notifyCartChanged(count: number) {
  window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail: count }));
}

/**
 * Header bag link with a live item count.
 *
 * The count is resolved on the client rather than during layout render: the
 * server path would make the layout dynamic and pull every catalogue page out
 * of the static tier, which the LCP budget depends on.
 *
 * Mutations push their own count in via the event; only the initial read hits
 * the API. Re-fetching after a mutation would race the Set-Cookie that creates
 * the cart on a first add and read back zero.
 */
export function CartBadge() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadInitial() {
      try {
        const res = await fetch("/api/cart/count", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { count: number };
        setCount(data.count);
      } catch {
        // Aborted or offline — the bag link still works without a count.
      }
    }

    function onChanged(event: Event) {
      setCount((event as CustomEvent<number>).detail);
    }

    void loadInitial();
    window.addEventListener(CART_CHANGED_EVENT, onChanged);

    return () => {
      controller.abort();
      window.removeEventListener(CART_CHANGED_EVENT, onChanged);
    };
  }, []);

  return (
    <Link href="/cart" className="transition-colors hover:text-accent-ink">
      <MicroLabel>Bag{count ? ` (${count})` : ""}</MicroLabel>
    </Link>
  );
}
