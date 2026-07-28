import { Suspense } from "react";

import type { Metadata } from "next";
import Loading from "./loading";
import Link from "next/link";

import {
  hsnSummary,
  invoiceSeriesHealth,
  ndrQueue,
  rtoBreakdown,
  statusCounts,
  summariseRevenue,
  summariseInvoice,
  type Order,
} from "@siumora/core";
import { formatPaise } from "@siumora/in-locale";
import { CollectionTitle, Display, MicroLabel } from "@siumora/ui";

import { getTrackingReport, listAllOrders } from "@/lib/order-store";
import { currentViewer } from "@/lib/session";

export const metadata: Metadata = {
  title: "Ops",
  robots: { index: false, follow: false },
};


async function AdminPageContents() {
  const viewer = await currentViewer();

  // Checked here so the page does not render, and again by the API before it
  // returns a figure. Either alone would be a single point of failure.
  if (!viewer?.isAdmin) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-5 py-32 text-center">
        <Display as="h1" size="sm">
          Ops
        </Display>
        <p className="mt-4 text-content-muted">
          {viewer
            ? "This account is not on the operator list."
            : "Sign in with an operator number to open the dashboard."}
        </p>
        {!viewer && (
          <Link
            href="/signin?next=/admin"
            className="mt-8 border-b border-content pb-1 transition-colors hover:border-accent-ink hover:text-accent-ink"
          >
            <MicroLabel>Sign in</MicroLabel>
          </Link>
        )}
      </div>
    );
  }

  const [orders, tracking] = await Promise.all([
    listAllOrders(),
    getTrackingReport(),
  ]);

  const revenue = summariseRevenue(orders);
  const byPincode = rtoBreakdown(orders, (o) => o.address.pincode);
  const byPayment = rtoBreakdown(orders, (o) => o.paymentMethod);
  const queue = ndrQueue(orders);
  const counts = statusCounts(orders);
  const series = invoiceSeriesHealth(orders);

  return (
    <div className="mx-auto max-w-5xl px-5 py-14">
      <Display as="h1" size="sm">
        Ops
      </Display>

      {/* 2FA beyond the sign-in code is still outstanding, and this page is
          worth being straight about rather than implying it is fully hardened. */}
      <p className="mt-3 text-sm text-content-faint">
        Signed in as {viewer.customer.maskedPhone}. Operator access comes from
        the <code>ADMIN_PHONES</code> allow-list; a second factor beyond the
        sign-in code is not built yet.
      </p>

      <section className="mt-10">
        <CollectionTitle className="text-xs">Revenue</CollectionTitle>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Recognised" value={formatPaise(revenue.recognised)} note="Delivered only" accent />
          <Stat label="In flight" value={formatPaise(revenue.inFlight)} note="Still at risk" />
          <Stat label="Lost" value={formatPaise(revenue.lost)} note="Returned or cancelled" />
          <Stat
            label="Average order"
            value={revenue.aov === null ? "—" : formatPaise(revenue.aov)}
            note={`${revenue.orderCount} orders`}
          />
        </div>
        <p className="mt-3 text-xs text-content-muted">
          Booked value is {formatPaise(revenue.booked)}. Only delivered orders
          count as revenue — a parcel in transit can still come back.
        </p>
      </section>

      <Section title="Failed deliveries">
        {queue.length === 0 ? (
          <Empty>Nothing waiting on a customer answer.</Empty>
        ) : (
          <ul className="divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
            {queue.map((order) => (
              <li key={order.id} className="flex items-baseline justify-between gap-4 py-3">
                <Link href={`/orders/${order.number}`} className="hover:text-accent-ink">
                  <MicroLabel>{order.number}</MicroLabel>
                </Link>
                <span className="text-sm text-content-muted">
                  Attempt {order.deliveryAttempts ?? 1} · {order.address.pincode}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="RTO by pincode">
        <RtoTable rows={byPincode} emptyNote="No settled orders yet." />
      </Section>

      <Section title="RTO by payment method">
        <RtoTable rows={byPayment} emptyNote="No settled orders yet." />
      </Section>

      <Section title="GST desk">
        <div className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
          <span>
            <span className="text-content-muted">Invoices issued </span>
            {series.issued}
          </span>
          <span className={series.healthy ? "" : "text-accent-ink"}>
            <span className="text-content-muted">Series </span>
            {series.healthy
              ? "unbroken"
              : `gaps at ${series.gaps.join(", ")}`}
          </span>
        </div>
        <HsnTable orders={orders} />
      </Section>

      <Section title="Marketing health">
        {tracking ? (
          <>
            <div className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
              <span>
                <span className="text-content-muted">Sent </span>
                {tracking.health.sent}
              </span>
              <span>
                <span className="text-content-muted">Queued </span>
                {tracking.health.pending}
              </span>
              <span
                className={tracking.health.failed > 0 ? "text-accent-ink" : undefined}
              >
                <span className="text-content-muted">Failed </span>
                {tracking.health.failed}
              </span>
              <span>
                {/* Built but never sent, because no destination is configured.
                    Shown rather than hidden: it is the difference between
                    "nothing happened" and "nothing could happen". */}
                <span className="text-content-muted">Not configured </span>
                {tracking.health.skipped}
              </span>
            </div>

            <p className="mt-4 text-sm">
              {tracking.missingConversions.length === 0 ? (
                <span className="text-content-muted">
                  Every order has a conversion against it.
                </span>
              ) : (
                <span className="text-accent-ink">
                  {tracking.missingConversions.length} orders have no conversion:{" "}
                  {tracking.missingConversions
                    .slice(0, 6)
                    .map((order) => order.number)
                    .join(", ")}
                </span>
              )}
            </p>
          </>
        ) : (
          <Empty>Tracking figures are unavailable.</Empty>
        )}
      </Section>

      <Section title="Order states">
        {Object.keys(counts).length === 0 ? (
          <Empty>No orders yet.</Empty>
        ) : (
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {Object.entries(counts).map(([status, count]) => (
              <span key={status}>
                <span className="text-content-muted">
                  {status.replace(/_/g, " ")}{" "}
                </span>
                {count}
              </span>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <CollectionTitle className="text-xs">{title}</CollectionTitle>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-content-muted">{children}</p>;
}

function Stat({
  label,
  value,
  note,
  accent,
}: {
  label: string;
  value: string;
  note?: string;
  accent?: boolean;
}) {
  return (
    <div className="border border-[var(--color-rule)] p-4">
      <MicroLabel>{label}</MicroLabel>
      <p
        className={`mt-2 font-display text-2xl font-light ${accent ? "text-accent-ink" : "text-content"}`}
      >
        {value}
      </p>
      {note && <p className="mt-1 text-xs text-content-faint">{note}</p>}
    </div>
  );
}

function RtoTable({
  rows,
  emptyNote,
}: {
  rows: ReturnType<typeof rtoBreakdown>;
  emptyNote: string;
}) {
  if (rows.length === 0) return <Empty>{emptyNote}</Empty>;

  return (
    <table className="w-full text-sm">
      <thead className="text-content-muted">
        <tr className="text-left">
          <th className="pb-2 font-normal">Key</th>
          <th className="pb-2 text-right font-normal">Settled</th>
          <th className="pb-2 text-right font-normal">Returned</th>
          <th className="pb-2 text-right font-normal">Rate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-t border-[var(--color-rule)]">
            <td className="py-2">{row.key}</td>
            <td className="py-2 text-right tabular-nums">{row.orders}</td>
            <td className="py-2 text-right tabular-nums">{row.returned}</td>
            {/* A quarter of a lane coming back is the point at which the
                unit economics stop working. */}
            <td
              className={`py-2 text-right tabular-nums ${row.rate >= 0.25 ? "text-accent-ink" : ""}`}
            >
              {Math.round(row.rate * 100)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HsnTable({ orders }: { orders: readonly Order[] }) {
  // Only invoiced orders belong on a GST summary.
  const lines = orders
    .filter((order) => order.invoiceNumber)
    .flatMap((order) => order.lines);

  if (lines.length === 0) {
    return <p className="mt-4 text-sm text-content-muted">No invoices raised yet.</p>;
  }

  const rows = hsnSummary(lines, { interState: false });
  const totals = summariseInvoice(rows);

  return (
    <table className="mt-5 w-full text-sm">
      <thead className="text-content-muted">
        <tr className="text-left">
          <th className="pb-2 font-normal">HSN</th>
          <th className="pb-2 text-right font-normal">Taxable</th>
          <th className="pb-2 text-right font-normal">Tax</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.hsn}-${row.slab}`} className="border-t border-[var(--color-rule)]">
            <td className="py-2">
              {row.hsn} <span className="text-content-faint">@{row.slab}%</span>
            </td>
            <td className="py-2 text-right tabular-nums">
              {formatPaise(row.taxableValue, { showPaise: true })}
            </td>
            <td className="py-2 text-right tabular-nums">
              {formatPaise(row.cgst + row.sgst + row.igst, { showPaise: true })}
            </td>
          </tr>
        ))}
        <tr className="border-t border-content/20 font-medium">
          <td className="py-2">Total</td>
          <td className="py-2 text-right tabular-nums">
            {formatPaise(totals.taxableValue, { showPaise: true })}
          </td>
          <td className="py-2 text-right tabular-nums">
            {formatPaise(totals.totalTax, { showPaise: true })}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * Static shell. The dynamic read — cookies, and the session behind them —
 * happens inside the boundary, so the rest of the route still prerenders and
 * the hole streams in.
 */
export default function AdminPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AdminPageContents />
    </Suspense>
  );
}
