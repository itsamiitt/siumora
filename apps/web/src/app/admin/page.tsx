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

import {
  getAuditLog,
  getOperatorAccess,
  getQueues,
  getRemittanceReport,
  getTrackingReport,
  listAllOrders,
  type AuditEntry,
  type MessageQueue,
  type PrivacyQueue,
  type RemittanceReport,
} from "@/lib/order-store";
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

  const [orders, tracking, remittances, access, queues] = await Promise.all([
    listAllOrders(),
    getTrackingReport(),
    getRemittanceReport(),
    getOperatorAccess(),
    getQueues(),
  ]);

  const may = (permission: string) => access?.permissions.includes(permission) ?? false;
  // Only fetched when it can be read, so a viewer's dashboard does not make a
  // request that comes back 403 every time it loads.
  const auditEntries = may("audit:read") ? await getAuditLog() : [];

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

      {/* Says plainly whether this account has a second factor. A dashboard
          that implies it is hardened when it is not is worse than one that
          says so. */}
      <p className="mt-3 text-sm text-content-faint">
        Signed in as {viewer.customer.maskedPhone}
        {access ? ` · ${access.role}` : ""}. Roles come from the{" "}
        <code>ADMIN_PHONES</code> allow-list.{" "}
        {access?.twoFactor?.enrolled
          ? "A second factor is enrolled on this account."
          : "No second factor is enrolled on this account yet."}
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

      {may("gst:read") && (
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
      )}

      {may("remittance:write") && (
        <Section title="COD remittances">
          <RemittancePanel report={remittances} />
        </Section>
      )}

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
              <span>
                {/* Claimed by the worker. Persistently non-zero means a worker
                    died mid-send and its claims are waiting to be reclaimed. */}
                <span className="text-content-muted">In flight </span>
                {tracking.health.sending}
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

      {may("audit:read") && (
        <Section title="Recent activity">
          <AuditTable entries={auditEntries} />
        </Section>
      )}

      <Section title="Customer messages">
        <MessagePanel queue={queues.messages} />
      </Section>

      {may("privacy:write") && (
        <Section title="Data requests">
          <PrivacyPanel queue={queues.privacy} />
        </Section>
      )}

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

function MessagePanel({ queue }: { queue?: MessageQueue }) {
  if (!queue) return <Empty>Message figures are unavailable.</Empty>;

  const { health, failed } = queue;

  return (
    <>
      <div className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
        <span>
          <span className="text-content-muted">Queued </span>
          {health.pending}
        </span>
        <span>
          <span className="text-content-muted">Sent </span>
          {health.sent}
        </span>
        <span className={health.failed > 0 ? "text-accent-ink" : undefined}>
          <span className="text-content-muted">Failed </span>
          {health.failed}
        </span>
        <span>
          {/* No WhatsApp or SMS provider is wired up yet. Shown rather than
              hidden: it is the difference between "nothing happened" and
              "nothing could happen". */}
          <span className="text-content-muted">No channel </span>
          {health.skipped}
        </span>
      </div>

      {failed.length > 0 && (
        <ul className="mt-5 divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
          {failed.map((message) => (
            <li
              key={message.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
            >
              <MicroLabel>{message.templateKey.replace(/_/g, " ")}</MicroLabel>
              <span className="text-sm text-content-muted">
                {message.recipient}
                {message.lastError && (
                  <span className="text-accent-ink"> · {message.lastError}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const REQUEST_LABEL: Record<string, string> = {
  access: "Copy of their data",
  correction: "Correction",
  erasure: "Erasure",
};

function PrivacyPanel({ queue }: { queue?: PrivacyQueue }) {
  if (!queue) return <Empty>Request figures are unavailable.</Empty>;
  if (queue.open.length === 0) {
    return <Empty>No open requests.</Empty>;
  }

  return (
    <ul className="divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
      {queue.open.map((request) => (
        <li key={request.id} className="py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <MicroLabel>{REQUEST_LABEL[request.kind] ?? request.kind}</MicroLabel>
            {/* The deadline is the regulated part, so it is the thing shown
                rather than the date it arrived. */}
            <span
              className={`text-sm ${request.overdue ? "text-accent-ink" : "text-content-muted"}`}
            >
              {request.overdue ? "Overdue since " : "Due by "}
              {new Date(request.resolveBy).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "long",
              })}
            </span>
          </div>
          {request.note && (
            <p className="mt-1 text-sm text-content-faint">{request.note}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Plain-language names. The action slugs are for grouping, not for reading. */
const ACTION_LABEL: Record<string, string> = {
  "order.status": "Moved an order",
  "order.restock": "Put stock back",
  "remittance.ingest": "Booked a remittance file",
  "privacy.erase": "Erased a customer",
  "privacy.refuse": "Refused a privacy request",
  "gst.export": "Exported the GST return",
  "auth.admin_signin": "Signed in",
};

function AuditTable({ entries }: { entries: readonly AuditEntry[] }) {
  if (entries.length === 0) {
    return <Empty>Nothing recorded yet.</Empty>;
  }

  return (
    <table className="w-full text-sm">
      <thead className="text-content-muted">
        <tr className="text-left">
          <th className="pb-2 font-normal">What</th>
          <th className="pb-2 font-normal">Who</th>
          <th className="pb-2 text-right font-normal">When</th>
        </tr>
      </thead>
      <tbody>
        {entries.slice(0, 20).map((entry) => (
          <tr key={entry.id} className="border-t border-[var(--color-rule)]">
            <td className="py-2">
              {ACTION_LABEL[entry.action] ?? entry.action}
              {entry.subject && (
                <span className="text-content-faint"> · {entry.subject}</span>
              )}
            </td>
            {/* Masked. Full numbers stay in the table for accountability; a
                screen anybody can shoulder-surf does not need them. */}
            <td className="py-2 text-content-muted">
              {entry.actorPhone}{" "}
              <span className="text-content-faint">({entry.actorRole})</span>
            </td>
            <td className="py-2 text-right tabular-nums text-content-muted">
              {new Date(entry.createdAt).toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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

/** Plain-language names for the outcomes; the raw enum is not for reading. */
const OUTCOME_LABELS: Record<string, string> = {
  short: "Short collection",
  over: "Overcollected",
  unknown_order: "No such order",
  not_cod: "Prepaid order",
  not_delivered: "Never delivered",
  duplicate: "Already paid",
};

function RemittancePanel({ report }: { report?: RemittanceReport }) {
  if (!report) return <Empty>Remittance figures are unavailable.</Empty>;

  const { cash, batches, exceptions } = report;
  const owed = batches.reduce((total, batch) => total + batch.shortfall, 0);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* The distinction the whole panel exists to draw: cash the shop has
            against cash somebody else is holding. */}
        <Stat
          label="In the bank"
          value={formatPaise(cash.prepaidSettled + cash.codRemitted)}
          note="Prepaid and remitted"
        />
        <Stat
          label="With the courier"
          value={formatPaise(cash.codAwaitingRemittance)}
          note="Delivered, not yet paid"
          accent={cash.codAwaitingRemittance > 0}
        />
        <Stat
          label="In transit"
          value={formatPaise(cash.codInTransit)}
          note="Nothing collected yet"
        />
        <Stat
          label="Short"
          value={formatPaise(owed)}
          note={owed > 0 ? "Money to chase" : "Nothing outstanding"}
          accent={owed > 0}
        />
      </div>

      {batches.length === 0 ? (
        <p className="mt-6 text-sm text-content-muted">
          No remittance file has been reconciled yet.
        </p>
      ) : (
        <table className="mt-6 w-full text-sm">
          <thead className="text-content-muted">
            <tr className="text-left">
              <th className="pb-2 font-normal">Batch</th>
              <th className="pb-2 text-right font-normal">Collected</th>
              {/* Freight and the COD charge. Expected to be non-zero — it is
                  only a problem when it outgrows the rate card. */}
              <th className="pb-2 text-right font-normal">Kept</th>
              <th className="pb-2 text-right font-normal">Remitted</th>
              <th className="pb-2 text-right font-normal">Open</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => (
              <tr key={batch.batchId} className="border-t border-[var(--color-rule)]">
                <td className="py-2">
                  {batch.batchId}{" "}
                  <span className="text-content-faint">
                    {batch.courier} · {batch.rows} rows
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatPaise(batch.collected)}
                </td>
                <td className="py-2 text-right tabular-nums text-content-muted">
                  {formatPaise(batch.deductions)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatPaise(batch.remitted)}
                </td>
                <td
                  className={`py-2 text-right tabular-nums ${batch.exceptions > 0 ? "text-accent-ink" : ""}`}
                >
                  {batch.exceptions}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {exceptions.length > 0 && (
        <ul className="mt-6 divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
          {/* Worst first, as the API ordered them: money missing outranks a
              keying error. */}
          {exceptions.slice(0, 10).map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
            >
              <Link
                href={`/orders/${entry.orderNumber}`}
                className="hover:text-accent-ink"
              >
                <MicroLabel>{entry.orderNumber}</MicroLabel>
              </Link>
              <span className="text-sm text-content-muted">
                {OUTCOME_LABELS[entry.outcome] ?? entry.outcome}
                {entry.variance !== 0 && (
                  <span className="text-accent-ink">
                    {" "}
                    {entry.variance < 0 ? "−" : "+"}
                    {formatPaise(Math.abs(entry.variance))}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
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
