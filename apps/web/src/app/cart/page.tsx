import type { Metadata } from "next";
import Link from "next/link";

import { calculateTotals, shippingFor } from "@siumora/core";
import { Display, MicroLabel } from "@siumora/ui";

import { CartLines } from "@/components/cart-lines";
import { FreeShippingProgress } from "@/components/free-shipping-progress";
import { OrderSummary } from "@/components/order-summary";
import { getCartLines } from "@/lib/cart-store";

export const metadata: Metadata = {
  title: "Bag",
  robots: { index: false },
};

// The cart is per-visitor, so it can never be cached or prerendered.
export const dynamic = "force-dynamic";

export default async function CartPage() {
  const lines = await getCartLines();

  if (lines.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-5 py-32 text-center">
        <Display as="h1" size="sm">
          Your bag is empty.
        </Display>
        <p className="mt-4 text-content-muted">
          Nothing kept here yet. Something is waiting.
        </p>
        <Link
          href="/collections/everyday"
          className="mt-8 border-b border-content pb-1 transition-colors hover:border-accent-ink hover:text-accent-ink"
        >
          <MicroLabel>Shop everyday</MicroLabel>
        </Link>
      </div>
    );
  }

  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const totals = calculateTotals(lines, {
    // Assumed intra-state until the delivery address is known at checkout.
    interState: false,
    shipping: shippingFor(subtotal),
  });

  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
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

          <Link
            href="/checkout"
            className="mt-6 flex h-14 w-full items-center justify-center bg-accent font-body text-[13px] font-medium uppercase text-ivory transition-colors hover:bg-accent/90"
            style={{ letterSpacing: "var(--tracking-caps)" }}
          >
            Checkout
          </Link>

          <ul className="mt-6 space-y-1.5 text-xs text-content-muted">
            <li>GST invoice with every order</li>
            <li>7-day returns</li>
            <li>Every piece wrapped as a gift</li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
