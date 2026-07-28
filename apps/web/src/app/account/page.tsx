import type { Metadata } from "next";
import Link from "next/link";

import type { OrderStatus } from "@siumora/core";
import { formatPaise } from "@siumora/in-locale";
import { Display, MicroLabel } from "@siumora/ui";

import { SignOutButton } from "@/components/sign-out-button";
import { listOrders } from "@/lib/order-store";
import { currentViewer } from "@/lib/session";

export const metadata: Metadata = {
  title: "Your orders",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

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

export default async function AccountPage() {
  const viewer = await currentViewer();

  if (!viewer) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-5 py-32 text-center">
        <Display as="h1" size="sm">
          Your orders
        </Display>
        <p className="mt-4 text-content-muted">
          Sign in with your mobile number to see everything you have ordered.
        </p>
        <Link
          href="/signin?next=/account"
          className="mt-8 border-b border-content pb-1 transition-colors hover:border-accent-ink hover:text-accent-ink"
        >
          <MicroLabel>Sign in</MicroLabel>
        </Link>
      </div>
    );
  }

  const orders = await listOrders();

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <Display as="h1" size="sm">
          Your orders
        </Display>
        <SignOutButton />
      </div>

      <p className="mt-3 text-sm text-content-faint">
        Signed in as {viewer.customer.maskedPhone}.
        {viewer.isAdmin && (
          <>
            {" "}
            <Link
              href="/admin"
              className="border-b border-content/40 pb-0.5 hover:border-accent-ink hover:text-accent-ink"
            >
              Open the ops dashboard
            </Link>
            .
          </>
        )}
      </p>

      {orders.length === 0 ? (
        <div className="mt-16 text-center">
          <p className="text-content-muted">No orders yet.</p>
          <Link
            href="/collections/everyday"
            className="mt-6 inline-block border-b border-content pb-1 transition-colors hover:border-accent-ink hover:text-accent-ink"
          >
            <MicroLabel>Start here</MicroLabel>
          </Link>
        </div>
      ) : (
        <ul className="mt-10 divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
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
    </div>
  );
}
