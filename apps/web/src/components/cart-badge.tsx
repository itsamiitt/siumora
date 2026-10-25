"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { BagDrawer } from "./bag-drawer";
import { StoreIcon } from "./store-icon";

/** Dispatched after any cart mutation, carrying the authoritative new count. */
export const CART_CHANGED_EVENT = "siumora:cart-changed";

export function notifyCartChanged(count: number) {
  window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail: count }));
}

/** Opens the bag drawer — after an add, with the variant just added to mark. */
export const OPEN_BAG_EVENT = "siumora:open-bag";

export function openBag(detail: { added?: string } = {}) {
  window.dispatchEvent(new CustomEvent(OPEN_BAG_EVENT, { detail }));
}

/** Pages that are the bag, or past it: the icon simply goes to /cart there. */
const BAG_PAGES = ["/cart", "/checkout"];

/**
 * Header bag link with a live item count, and the bag drawer it opens.
 *
 * The count is resolved on the client rather than during layout render: the
 * server path would make the layout dynamic and pull every catalogue page out
 * of the static tier, which the LCP budget depends on.
 *
 * Mutations push their own count in via the event; only the initial read hits
 * the API. Re-fetching after a mutation would race the Set-Cookie that creates
 * the cart on a first add and read back zero.
 *
 * The icon opens the drawer in place (plan 16 Phase D) — the shopper keeps
 * the page they were on. It stays a real link to /cart, so it still works
 * before hydration, with a modifier key, and on the bag and checkout pages.
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
    <>
      <Link
        href="/cart"
        aria-label={`Bag${count ? ` (${count})` : ""}`}
        className="store-icon-button store-bag"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          if (BAG_PAGES.some((path) => window.location.pathname.startsWith(path))) return;
          event.preventDefault();
          openBag();
        }}
      >
        <StoreIcon name="bag" />
        {count !== null && count > 0 && <span className="store-bag-count" aria-hidden="true">{count}</span>}
      </Link>
      <BagDrawer />
    </>
  );
}
