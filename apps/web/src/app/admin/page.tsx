import type { Metadata } from "next";
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

import { listOrders } from "@/lib/order-store";

export const metadata: Metadata = {
  title: "Ops",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const orders = await listOrders();

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

      {/* There is no auth on this route. Saying so beats letting someone
          assume a login is protecting it. */}
      <p className="mt-3 text-sm text-mulberry">
        No authentication yet — this route is open. It must sit behind admin
        sign-in and 2FA before the site is public.
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
        <p className="mt-3 text-xs text-ink-muted">
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
                <Link href={`/orders/${order.number}`} className="hover:text-mulberry">
                  <MicroLabel>{order.number}</MicroLabel>
                </Link>
                <span className="text-sm text-ink-muted">
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
            <span className="text-ink-muted">Invoices issued </span>
            {series.issued}
          </span>
          <span className={series.healthy ? "" : "text-mulberry"}>
            <span className="text-ink-muted">Series </span>
            {series.healthy
              ? "unbroken"
              : `gaps at ${series.gaps.join(", ")}`}
          </span>
        </div>
        <HsnTable orders={orders} />
      </Section>

      <Section title="Order states">
        {Object.keys(counts).length === 0 ? (
          <Empty>No orders yet.</Empty>
        ) : (
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {Object.entries(counts).map(([status, count]) => (
              <span key={status}>
                <span className="text-ink-muted">
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
  return <p className="text-sm text-ink-muted">{children}</p>;
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
        className={`mt-2 font-display text-2xl font-light ${accent ? "text-mulberry" : "text-ink"}`}
      >
        {value}
      </p>
      {note && <p className="mt-1 text-xs text-ink-faint">{note}</p>}
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
      <thead className="text-ink-muted">
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
              className={`py-2 text-right tabular-nums ${row.rate >= 0.25 ? "text-mulberry" : ""}`}
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
    return <p className="mt-4 text-sm text-ink-muted">No invoices raised yet.</p>;
  }

  const rows = hsnSummary(lines, { interState: false });
  const totals = summariseInvoice(rows);

  return (
    <table className="mt-5 w-full text-sm">
      <thead className="text-ink-muted">
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
              {row.hsn} <span className="text-ink-faint">@{row.slab}%</span>
            </td>
            <td className="py-2 text-right tabular-nums">
              {formatPaise(row.taxableValue, { showPaise: true })}
            </td>
            <td className="py-2 text-right tabular-nums">
              {formatPaise(row.cgst + row.sgst + row.igst, { showPaise: true })}
            </td>
          </tr>
        ))}
        <tr className="border-t border-ink/20 font-medium">
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
