import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { calculateTotals, shippingFor } from "@siumora/core";
import { Display, MicroLabel } from "@siumora/ui";

import { CheckoutForm } from "@/components/checkout-form";
import { OrderSummary } from "@/components/order-summary";
import { getCartLines } from "@/lib/cart-store";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const lines = await getCartLines();
  if (lines.length === 0) redirect("/cart");

  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const totals = calculateTotals(lines, {
    interState: false,
    shipping: shippingFor(subtotal),
  });

  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <div className="flex items-baseline justify-between gap-6">
        <Display as="h1" size="sm">
          Checkout
        </Display>
        <Link href="/cart" className="transition-colors hover:text-mulberry">
          <MicroLabel>Back to bag</MicroLabel>
        </Link>
      </div>

      <div className="mt-10 grid gap-14 lg:grid-cols-[1fr_22rem]">
        <CheckoutForm subtotal={subtotal} />

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <OrderSummary totals={totals} />
          <ul className="mt-6 space-y-1.5 text-xs text-ink-muted">
            <li>Secure payment · GST invoice</li>
            <li>7-day returns</li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
