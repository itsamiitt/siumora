import { Suspense } from "react";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { calculateTotals, shippingFor } from "@siumora/core";
import { Display, MicroLabel } from "@siumora/ui";

import { api } from "@/lib/api";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { getCartView } from "@/lib/cart-store";
import { apiAs, currentViewer } from "@/lib/session";

import Loading from "./loading";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false },
};

/**
 * Checkout keeps the shopper on the job (plan 16 Phase C): the store's
 * navigation, search, announcement and footer are hidden here, leaving the
 * logo and a way back to the bag. Scoped to this page — the style element
 * unmounts with it — and server-rendered, so nothing flashes in first.
 */
const FOCUS_CSS =
  ".store-announcement,.store-desktop-nav,.store-header-tools,.store-menu-trigger," +
  ".store-header-note,.store-footer,.festival-banner{display:none!important}";

/**
 * The paused state. The storefront keeps serving — browsing, bag and wishlist
 * all stay open — only the payment step is switched off. The API refuses a
 * paused checkout server-side too; this page is the honest explanation, not
 * the enforcement.
 */
function CheckoutPaused() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-24 text-center">
      <Display as="h1" size="sm">
        Checkout is paused
      </Display>
      <p className="mt-6 text-content-muted">
        Payment is switched off right now — nothing can be charged. Your bag is
        saved exactly as you left it, and browsing stays open. We will be back
        shortly.
      </p>
      <p className="mt-10">
        <Link href="/" className="transition-colors hover:text-accent-ink">
          <MicroLabel>Back to the shop</MicroLabel>
        </Link>
      </p>
    </div>
  );
}

async function CheckoutPageContents() {
  // Uncached read inside the Suspense boundary (the shell prerenders under
  // Cache Components): the kill-switch must be visible without a rebuild.
  const client = api();
  const { paymentsEnabled, razorpayConfigured, checkout } = await client.getStoreConfig();
  if (!paymentsEnabled) return <CheckoutPaused />;

  const { lines, coupons } = await getCartView();
  if (lines.length === 0) redirect("/cart");

  // Signed in: start from their number and their address book (auth plan
  // phase 2). A failed read just means typing the address once more.
  const viewer = await currentViewer();
  const savedAddresses = viewer
    ? await (await apiAs()).listAddresses().catch(() => [])
    : [];

  // What to show until the first quote lands: prepaid, intra-state — the
  // quote replaces it with the server's figure for the address and method.
  // Free shipping is judged after any coupon (plan 16 B19), as the server does.
  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity - (l.discount ?? 0), 0);
  const totals = calculateTotals(lines, { interState: false, shipping: shippingFor(subtotal) });

  return (
    <CheckoutForm
      lines={lines}
      initialTotals={{
        subtotal: totals.subtotal,
        discount: totals.discount,
        shipping: totals.shipping,
        codFee: 0,
        total: totals.total,
        gst: {
          taxableValue: totals.gst.taxableValue,
          cgst: totals.gst.cgst,
          sgst: totals.gst.sgst,
          igst: totals.gst.igst,
        },
      }}
      initialCoupons={coupons}
      giftMessageOffered={checkout?.giftMessage ?? false}
      remindersOffered={checkout?.cartReminders ?? false}
      razorpayConfigured={razorpayConfigured}
      paymentFlow={client.paymentFlow}
      savedAddresses={savedAddresses}
      {...(viewer ? { viewerPhone: viewer.customer.phone } : {})}
    />
  );
}

/**
 * Static shell. The dynamic read — cookies, and the session behind them —
 * happens inside the boundary, so the rest of the route still prerenders and
 * the hole streams in.
 */
export default function CheckoutPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-16 pt-8 lg:pt-12">
      <style>{FOCUS_CSS}</style>
      <div className="mb-6 flex items-baseline justify-between gap-6 lg:mb-10">
        <Display as="h1" size="sm">
          Checkout
        </Display>
        <Link href="/cart" className="min-h-11 transition-colors hover:text-accent-ink">
          <MicroLabel>← Back to bag</MicroLabel>
        </Link>
      </div>
      <Suspense fallback={<Loading bare />}>
        <CheckoutPageContents />
      </Suspense>
    </div>
  );
}
