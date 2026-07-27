import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { hsnSummary, summariseInvoice } from "@siumora/core";
import { formatPaise } from "@siumora/in-locale";
import { CollectionTitle, Display, MicroLabel, SiumoraMark } from "@siumora/ui";

import { ConfirmOrder } from "@/components/confirm-order";
import { OrderProgress } from "@/components/order-progress";
import { ReturnForm } from "@/components/return-form";
import { TrackPurchase } from "@/components/track-purchase";
import { getOrder, nextStatuses } from "@/lib/order-store";
import { getReturnForOrder } from "@/lib/return-store";

export const metadata: Metadata = {
  title: "Order confirmed",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ number: string }>;
}

export default async function OrderPage({ params }: PageProps) {
  const { number } = await params;
  const order = await getOrder(number);
  if (!order) notFound();

  const openReturn = await getReturnForOrder(order.number);
  const rows = hsnSummary(order.lines, { interState: order.interState });
  const invoice = summariseInvoice(rows);

  // The heading must match the order's real state. Telling someone their order
  // is confirmed while it still awaits payment or a COD callback is the kind of
  // false reassurance that turns into a support ticket.
  const headline =
    order.status === "awaiting_cod_confirmation"
      ? {
          title: "Almost there.",
          detail:
            "We will send a WhatsApp message to confirm this order before we pack it.",
        }
      : order.status === "pending_payment"
        ? {
            title: "Order received.",
            detail:
              "Payment is still to be collected — Razorpay is not connected in this environment, so nothing has been charged.",
          }
        : {
            title: "Thank you.",
            detail:
              "Your order is confirmed. Every piece leaves here wrapped as a gift.",
          };

  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <TrackPurchase order={order} />

      <div className="text-center">
        <SiumoraMark size={44} className="mx-auto" />
        <Display as="h1" size="sm" className="mt-6">
          {headline.title}
        </Display>
        <p className="mt-3 text-ink-muted">{headline.detail}</p>
        <p className="mt-5">
          <MicroLabel>Order {order.number}</MicroLabel>
        </p>
      </div>

      {order.status === "awaiting_cod_confirmation" && (
        <ConfirmOrder orderNumber={order.number} />
      )}

      {order.status === "delivered" && !openReturn && (
        <ReturnForm orderNumber={order.number} lines={order.lines} />
      )}

      {openReturn && (
        <div className="mt-8 border border-mulberry/25 bg-mulberry/[0.04] p-5">
          <MicroLabel tone="mulberry">Return {openReturn.status}</MicroLabel>
          <p className="mt-2 text-sm text-ink-muted">
            {openReturn.freeReturnShipping
              ? "We are covering return shipping."
              : "Return shipping is deducted from the refund."}{" "}
            {openReturn.refundTo === "upi"
              ? "Your refund goes back by UPI."
              : "Your refund goes back to the original payment method."}
          </p>
        </div>
      )}

      <OrderProgress
        orderNumber={order.number}
        next={nextStatuses(order.status)}
      />

      <div className="mt-12 border border-[var(--color-rule)] p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <CollectionTitle className="text-xs">Tax invoice</CollectionTitle>
          {order.invoiceNumber ? (
            <span className="text-sm text-ink-muted">{order.invoiceNumber}</span>
          ) : (
            // No number is burned until the order is confirmed — the series has
            // to stay gapless within the financial year.
            <span className="text-sm text-ink-faint">
              Issued once confirmed
            </span>
          )}
        </div>

        <ul className="mt-6 divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
          {order.lines.map((line) => (
            <li key={line.variantId} className="flex justify-between gap-4 py-3.5">
              <div>
                <p className="text-sm">
                  {line.title}
                  <span className="text-ink-muted"> · {line.variantTitle}</span>
                </p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  HSN {line.hsn} · {line.gstSlab}% GST · Qty {line.quantity}
                </p>
              </div>
              <p className="shrink-0 text-sm">
                {formatPaise(line.unitPrice * line.quantity)}
              </p>
            </li>
          ))}
        </ul>

        {/* HSN-wise breakup — the shape the GST return is filed in. */}
        <table className="mt-6 w-full text-xs">
          <thead className="text-ink-muted">
            <tr className="text-left">
              <th className="pb-2 font-normal">HSN</th>
              <th className="pb-2 text-right font-normal">Taxable</th>
              {order.interState ? (
                <th className="pb-2 text-right font-normal">IGST</th>
              ) : (
                <>
                  <th className="pb-2 text-right font-normal">CGST</th>
                  <th className="pb-2 text-right font-normal">SGST</th>
                </>
              )}
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
                {order.interState ? (
                  <td className="py-2 text-right tabular-nums">
                    {formatPaise(row.igst, { showPaise: true })}
                  </td>
                ) : (
                  <>
                    <td className="py-2 text-right tabular-nums">
                      {formatPaise(row.cgst, { showPaise: true })}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatPaise(row.sgst, { showPaise: true })}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-6 space-y-2 border-t border-[var(--color-rule)] pt-4 text-sm">
          <Row label="Taxable value">
            {formatPaise(invoice.taxableValue, { showPaise: true })}
          </Row>
          <Row label="Total tax">
            {formatPaise(invoice.totalTax, { showPaise: true })}
          </Row>
          {order.totals.shipping > 0 && (
            <Row label="Shipping">{formatPaise(order.totals.shipping)}</Row>
          )}
          {order.totals.codFee > 0 && (
            <Row label="Cash on delivery fee">
              {formatPaise(order.totals.codFee)}
            </Row>
          )}
          <div className="flex justify-between gap-4 border-t border-[var(--color-rule)] pt-3">
            <dt className="font-medium">Total paid</dt>
            <dd className="text-lg font-medium">
              {formatPaise(order.totals.total)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-10 text-center">
        <Link
          href="/collections/everyday"
          className="border-b border-ink pb-1 transition-colors hover:border-mulberry hover:text-mulberry"
        >
          <MicroLabel>Keep looking</MicroLabel>
        </Link>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}
