import Image from "next/image";

import type { CartLine } from "@siumora/core";
import type { QuotedTotals } from "@siumora/sdk";
import { formatPaise } from "@siumora/in-locale";
import { MicroLabel } from "@siumora/ui";

/**
 * The checkout's order summary (plan 16 Phase C): what is being bought and
 * exactly what will be charged — the server's totals for the chosen method,
 * so the COD fee and inter-state GST appear the moment they apply rather
 * than after Pay (Baymard: surprise costs are the top abandonment reason).
 *
 * Tax is shown as contained in the total, never added to it — matching the
 * invoice and the price on the product page.
 */
export function CheckoutSummary({
  lines,
  totals,
  interState,
  itemCount,
  coupon,
}: {
  lines: readonly CartLine[];
  totals: QuotedTotals;
  interState: boolean;
  itemCount: number;
  /** The coupon field (plan 16 B19), placed above the money. */
  coupon?: React.ReactNode;
}) {
  return (
    <div>
      <ul className="space-y-4">
        {lines.map((line) => (
          <li key={line.variantId} className="flex gap-3">
            <span className="relative shrink-0 bg-ground-raised">
              <Image
                src={line.imageUrl}
                alt=""
                width={56}
                height={70}
                className="h-[70px] w-14 object-cover"
              />
              {line.quantity > 1 && (
                <span className="absolute -right-2 -top-2 grid size-5 place-items-center rounded-full bg-content text-[10px] text-ground">
                  {line.quantity}
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1 text-sm">
              <span className="block truncate">{line.title}</span>
              <span className="block text-xs text-content-muted">{line.variantTitle}</span>
            </span>
            <span className="shrink-0 text-sm">{formatPaise(line.unitPrice * line.quantity)}</span>
          </li>
        ))}
      </ul>

      {coupon}

      <dl className="mt-6 space-y-2.5 border-t border-[var(--color-rule)] pt-5 text-sm">
        <Row label={`Subtotal (${itemCount} ${itemCount === 1 ? "item" : "items"})`}>
          {formatPaise(totals.subtotal)}
        </Row>
        {(totals.discount ?? 0) > 0 && (
          <Row label="Coupon">
            <span className="text-accent-ink">−{formatPaise(totals.discount ?? 0)}</span>
          </Row>
        )}
        <Row label="Shipping">{totals.shipping === 0 ? "Free" : formatPaise(totals.shipping)}</Row>
        {totals.codFee > 0 && <Row label="Cash on delivery fee">{formatPaise(totals.codFee)}</Row>}
        <div className="flex items-baseline justify-between gap-4 border-t border-[var(--color-rule)] pt-4">
          <dt className="font-medium">Total</dt>
          <dd className="font-display text-3xl font-light">{formatPaise(totals.total)}</dd>
        </div>
      </dl>

      {/* The breakup that appears on the GST invoice, to the paise: rounded,
          the components stop summing to the total. */}
      <details className="group mt-2 text-xs text-content-muted">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between">
          <span>
            Includes {formatPaise(totals.gst.cgst + totals.gst.sgst + totals.gst.igst, { showPaise: true })} GST
          </span>
          <span aria-hidden className="transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <dl className="space-y-1.5 pb-2">
          <Row label="Taxable value" small>
            {formatPaise(totals.gst.taxableValue, { showPaise: true })}
          </Row>
          {interState ? (
            <Row label="IGST" small>
              {formatPaise(totals.gst.igst, { showPaise: true })}
            </Row>
          ) : (
            <>
              <Row label="CGST" small>
                {formatPaise(totals.gst.cgst, { showPaise: true })}
              </Row>
              <Row label="SGST" small>
                {formatPaise(totals.gst.sgst, { showPaise: true })}
              </Row>
            </>
          )}
        </dl>
      </details>
    </div>
  );
}

/** The mobile bar above the steps: the total, and the summary folded under it. */
export function CollapsedSummary({
  total,
  children,
}: {
  total: number;
  children: React.ReactNode;
}) {
  return (
    <details className="group border-y border-[var(--color-rule)] lg:hidden">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4">
        <MicroLabel>
          Order summary <span aria-hidden className="inline-block transition-transform group-open:rotate-180">⌄</span>
        </MicroLabel>
        <span className="font-display text-2xl font-light">{formatPaise(total)}</span>
      </summary>
      <div className="pb-6">{children}</div>
    </details>
  );
}

function Row({
  label,
  children,
  small,
}: {
  label: string;
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className={small ? "" : "text-content-muted"}>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
