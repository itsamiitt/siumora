"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { mintEventId, track } from "@siumora/analytics/client";
import type { CartLine } from "@siumora/core";
import { formatPaise } from "@siumora/in-locale";
import { Drawer, MicroLabel, Skeleton, buttonClassName } from "@siumora/ui";

import { readBag } from "@/app/actions/cart";
import { analyticsItems } from "@/lib/checkout-rules";

import { CART_CHANGED_EVENT, OPEN_BAG_EVENT } from "./cart-badge";
import { CartLines } from "./cart-lines";
import { FreeShippingProgress } from "./free-shipping-progress";
import { StoreIcon } from "./store-icon";

/**
 * The bag, in a drawer (plan 16 Phase D).
 *
 * Opened by adding to the bag and by the header bag icon, so the shopper
 * keeps the page they were on — the considered-purchase hybrid: the drawer
 * for momentum, the full /cart page one link away for a slower look. The
 * lines are read from the server when it opens, never assumed from the
 * add, and the piece just added is marked. One mulberry action: Checkout,
 * carrying the subtotal.
 */
export function BagDrawer() {
  const [open, setOpen] = useState(false);
  const [bag, setBag] = useState<{ lines: CartLine[]; subtotal: number; count: number; unavailable?: boolean } | null>(null);
  const [added, setAdded] = useState<string | undefined>();
  const [, startLoading] = useTransition();
  const openRef = useRef(false);

  const load = useCallback(() => {
    startLoading(async () => {
      const next = await readBag();
      setBag(next);
    });
  }, []);

  useEffect(() => {
    function onOpen(event: Event) {
      const detail = (event as CustomEvent<{ added?: string }>).detail ?? {};
      setAdded(detail.added);
      setOpen(true);
      openRef.current = true;
      load();
    }
    function onChanged() {
      // Another surface changed the bag while the drawer is up.
      if (openRef.current) load();
    }
    window.addEventListener(OPEN_BAG_EVENT, onOpen);
    window.addEventListener(CART_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(OPEN_BAG_EVENT, onOpen);
      window.removeEventListener(CART_CHANGED_EVENT, onChanged);
    };
  }, [load]);

  // view_cart, once per opening, when the lines are in.
  const viewed = useRef(false);
  useEffect(() => {
    if (!open) {
      viewed.current = false;
      return;
    }
    if (viewed.current || !bag || bag.lines.length === 0) return;
    viewed.current = true;
    track("view_cart", {
      event_id: mintEventId(),
      currency: "INR",
      value: bag.subtotal / 100,
      items: analyticsItems(bag.lines),
    });
  }, [open, bag]);

  function close() {
    setOpen(false);
    openRef.current = false;
  }

  return (
    <Drawer open={open} onClose={close} label="Your bag">
      <div className="flex items-center justify-between border-b border-[var(--color-rule)] px-5 py-3">
        <MicroLabel>Your bag{bag && bag.count > 0 ? ` (${bag.count})` : ""}</MicroLabel>
        <button type="button" aria-label="Close bag" onClick={close} className="store-icon-button" autoFocus>
          <StoreIcon name="close" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        {!bag ? (
          <div className="space-y-4" aria-hidden>
            <Skeleton className="h-3 w-2/3" />
            {[0, 1].map((n) => (
              <div key={n} className="flex gap-4">
                <Skeleton className="h-[90px] w-[72px]" />
                <div className="flex-1">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="mt-2.5 h-3 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : bag.unavailable ? (
          <div className="py-16 text-center" role="alert">
            <p className="font-display text-2xl font-light">We couldn&apos;t load your bag.</p>
            <p className="mt-2 text-sm text-content-muted">Your pieces are safe. Please try again in a moment.</p>
            <button type="button" onClick={load} className={buttonClassName({ variant: "secondary", className: "mt-6" })}>
              Try again
            </button>
          </div>
        ) : bag.lines.length === 0 ? (
          <div className="py-16 text-center">
            <p className="font-display text-2xl font-light">Your bag is empty.</p>
            <p className="mt-2 text-sm text-content-muted">Nothing kept here yet. Something is waiting.</p>
            <Link href="/shop" onClick={close} className={buttonClassName({ variant: "secondary", className: "mt-6" })}>
              Shop everyday
            </Link>
          </div>
        ) : (
          <>
            <FreeShippingProgress subtotal={bag.subtotal} />
            <div className="mt-4">
              {/* Each change dispatches the cart-changed event, which re-reads the bag above. */}
              <CartLines lines={bag.lines} compact highlight={added} />
            </div>
          </>
        )}
      </div>

      {bag && bag.lines.length > 0 && (
        <div className="border-t border-[var(--color-rule)] px-5 pb-5 pt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm">Subtotal</span>
            <span className="font-display text-2xl font-light">{formatPaise(bag.subtotal)}</span>
          </div>
          <p className="mt-0.5 text-xs text-content-muted">Shipping and any cash-on-delivery fee shown at checkout.</p>
          <Link href="/checkout" onClick={close} className={buttonClassName({ size: "lg", className: "mt-4 w-full" })}>
            Checkout · {formatPaise(bag.subtotal)}
          </Link>
          <div className="mt-3 flex justify-center gap-6 text-sm">
            <Link href="/cart" onClick={close} className="min-h-11 py-2.5 underline-offset-4 hover:text-accent-ink hover:underline">
              View bag
            </Link>
            <button type="button" onClick={close} className="min-h-11 underline-offset-4 hover:text-accent-ink hover:underline">
              Continue shopping
            </button>
          </div>
          <p className="mt-1 text-center text-xs text-content-muted">Gift-wrapped · GST invoice · 7-day returns</p>
        </div>
      )}
    </Drawer>
  );
}
