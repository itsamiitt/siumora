import { Suspense } from "react";

import type { Metadata } from "next";
import Loading from "./loading";
import Link from "next/link";

import type { OrderStatus } from "@siumora/core";
import { formatPaise } from "@siumora/in-locale";
import type { ClaimableOrder } from "@siumora/sdk";
import { MicroLabel } from "@siumora/ui";

import { AccountShell, SignedOutAccount } from "@/components/account/account-shell";
import { ClaimOrders } from "@/components/account/claim-orders";
import { listOrders } from "@/lib/order-store";
import { apiAs, currentViewer } from "@/lib/session";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};


/** Plain-language status. The internal names are for the code, not the customer. */
const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "Payment pending",
  awaiting_cod_confirmation: "Awaiting your confirmation",
  confirmed: "Confirmed",
  processing: "Being packed",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  ndr: "Delivery attempted",
  rto: "Returned to us",
  cancelled: "Cancelled",
  returned: "Returned",
};

async function AccountPageContents() {
  const viewer = await currentViewer();
  if (!viewer) return <SignedOutAccount next="/account" />;

  const client = await apiAs();
  const [orderResult, claimable] = await Promise.all([
    listOrders()
      .then((orders) => ({ orders, unavailable: false }))
      .catch(() => ({ orders: [], unavailable: true })),
    // "Is this your order?" — guest orders on this number (Medusa only).
    client.listClaimableOrders().catch((): ClaimableOrder[] => []),
  ]);
  const { orders } = orderResult;

  return (
    <AccountShell viewer={viewer} section="orders">
      <ClaimOrders orders={claimable} />

      <h2 className="mt-10">
        <MicroLabel>Your orders</MicroLabel>
      </h2>
      {orderResult.unavailable ? (
        <div role="alert" className="mt-8 border border-[var(--color-rule)] p-5 text-sm">
          <p>We could not load your orders right now. Please try again shortly.</p>
          <form action="/account" method="get" className="mt-3">
            <button type="submit" className="min-h-11 underline underline-offset-4">
              Try again
            </button>
          </form>
        </div>
      ) : orders.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-content-muted">No orders yet.</p>
          <Link
            href="/collections/everyday"
            className="mt-6 inline-block border-b border-content pb-1 transition-colors hover:border-accent-ink hover:text-accent-ink"
          >
            <MicroLabel>Start here</MicroLabel>
          </Link>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/orders/${order.number}`}
                className="flex flex-wrap items-baseline justify-between gap-4 py-5 transition-colors hover:text-accent-ink"
              >
                <div>
                  <MicroLabel>{order.number}</MicroLabel>
                  <p className="mt-1.5 text-sm text-content-muted">
                    {order.lines.length}{" "}
                    {order.lines.length === 1 ? "piece" : "pieces"} ·{" "}
                    {new Date(order.placedAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                  {order.invoiceNumber && (
                    <p className="mt-1 text-xs text-content-faint">
                      Invoice {order.invoiceNumber}
                    </p>
                  )}
                </div>

                <div className="text-right">
                  <p className="font-medium">{formatPaise(order.totals.total)}</p>
                  <p className="mt-1 text-xs text-content-muted">
                    {STATUS_LABEL[order.status]}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AccountShell>
  );
}

/**
 * Static shell. The dynamic read — cookies, and the session behind them —
 * happens inside the boundary, so the rest of the route still prerenders and
 * the hole streams in.
 */
export default function AccountPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AccountPageContents />
    </Suspense>
  );
}
