import { Suspense } from "react";

import type { Metadata } from "next";
import Link from "next/link";

import { calculateTotals, shippingFor } from "@siumora/core";
import { formatPaise } from "@siumora/in-locale";
import { Display, MicroLabel, TrustRow, buttonClassName } from "@siumora/ui";

import { CartLines } from "@/components/cart-lines";
import { FreeShippingProgress } from "@/components/free-shipping-progress";
import { OrderSummary } from "@/components/order-summary";
import { PincodeChecker } from "@/components/pincode-checker";
import { ProductCard } from "@/components/product-card";
import { TrackViewCart } from "@/components/track-view-cart";
import { getCartLines } from "@/lib/cart-store";
import { listRecentProducts } from "@/lib/catalog";

import Loading from "./loading";

export const metadata: Metadata = {
  title: "Bag",
  robots: { index: false },
};

const TRUST = [
  { label: "Gift-wrapped" },
  { label: "GST invoice" },
  { label: "7-day returns" },
] as const;

/** An empty bag offers somewhere to go, not just a sentence (plan 16 Phase D). */
/** The read failed (reported in cart-store) — never claim the bag is empty. */
function BagUnavailable() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-20">
      <div className="mx-auto flex max-w-md flex-col items-center text-center" role="alert">
        <Display as="h1" size="sm">
          We couldn&apos;t load your bag.
        </Display>
        <p className="mt-4 text-content-muted">Your pieces are safe. Please refresh in a moment.</p>
        <Link href="/cart" className={buttonClassName({ variant: "secondary", className: "mt-8" })}>
          Try again
        </Link>
      </div>
    </div>
  );
}

async function EmptyBag() {
  const products = await listRecentProducts(4).catch(() => []);
  return (
    <div className="mx-auto max-w-6xl px-5 py-20">
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <Display as="h1" size="sm">
          Your bag is empty.
        </Display>
        <p className="mt-4 text-content-muted">Nothing kept here yet. Something is waiting.</p>
        <Link href="/shop" className={buttonClassName({ variant: "secondary", className: "mt-8" })}>
          Shop everyday
        </Link>
      </div>
      {products.length > 0 && (
        <section aria-labelledby="bag-suggestions" className="mt-20">
          <h2 id="bag-suggestions" className="mb-6 text-center">
            <MicroLabel>Loved this week</MicroLabel>
          </h2>
          <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

async function CartPageContents() {
  let lines: Awaited<ReturnType<typeof getCartLines>>;
  try {
    lines = await getCartLines();
  } catch {
    return <BagUnavailable />;
  }
  if (lines.length === 0) return <EmptyBag />;

  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const totals = calculateTotals(lines, {
    // Assumed intra-state until the delivery address is known at checkout.
    interState: false,
    shipping: shippingFor(subtotal),
  });
  const checkoutLabel = `Checkout · ${formatPaise(totals.total)}`;

  return (
    <div className="mx-auto max-w-6xl px-5 pb-32 pt-14 lg:pb-14">
      <TrackViewCart lines={lines} value={totals.total} />
      <Display as="h1" size="sm">
        Your bag
      </Display>

      <div className="mt-10 grid gap-14 lg:grid-cols-[1fr_22rem]">
        <div>
          <FreeShippingProgress subtotal={subtotal} />
          <CartLines lines={lines} />
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <OrderSummary totals={totals} />

          <Link href="/checkout" className={buttonClassName({ size: "lg", className: "mt-6 w-full" })}>
            {checkoutLabel}
          </Link>
          <p className="mt-2 text-center text-xs text-content-muted">
            UPI, cards, netbanking or cash on delivery
          </p>

          <TrustRow className="mt-6" layout="stacked" items={TRUST} />

          {/* Delivery checked here is remembered — checkout opens with it. */}
          <div className="mt-6 border-t border-[var(--color-rule)] pt-5">
            <PincodeChecker inline />
          </div>
        </aside>
      </div>

      {/* Phones: the total and the one action stay in reach while the lines
          scroll. Desktop has the sticky summary instead. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-rule)] bg-ground/95 px-5 py-3 backdrop-blur-sm lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="font-display text-2xl font-light leading-none">{formatPaise(totals.total)}</p>
            <p className="mt-1 text-xs text-content-muted">Inclusive of all taxes</p>
          </div>
          <Link href="/checkout" className={buttonClassName({ className: "shrink-0" })}>
            Checkout
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Static shell. The dynamic read — cookies, and the session behind them —
 * happens inside the boundary, so the rest of the route still prerenders and
 * the hole streams in.
 */
export default function CartPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CartPageContents />
    </Suspense>
  );
}
