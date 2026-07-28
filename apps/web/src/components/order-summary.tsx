import type { CartTotals } from "@siumora/core";
import { formatPaise } from "@siumora/in-locale";
import { MicroLabel } from "@siumora/ui";

/**
 * Order summary with the GST breakup.
 *
 * The tax lines are shown as contained within the total, never added to it —
 * matching the invoice and the price on the product page.
 */
export function OrderSummary({
  totals,
  interState = false,
}: {
  totals: CartTotals;
  interState?: boolean;
}) {
  return (
    <div className="border border-[var(--color-rule)] p-6">
      <MicroLabel>Summary</MicroLabel>

      <dl className="mt-5 space-y-2.5 text-sm">
        <Row label={`Subtotal (${totals.itemCount} items)`}>
          {formatPaise(totals.subtotal)}
        </Row>

        {totals.savings > 0 && (
          <Row label="You save" tone="mulberry">
            −{formatPaise(totals.savings)}
          </Row>
        )}

        <Row label="Shipping">
          {totals.shipping === 0 ? "Free" : formatPaise(totals.shipping)}
        </Row>

        {totals.codFee > 0 && (
          <Row label="Cash on delivery fee">{formatPaise(totals.codFee)}</Row>
        )}

        <div className="border-t border-[var(--color-rule)] pt-3.5">
          <div className="flex justify-between gap-4">
            <dt className="font-medium">Total</dt>
            <dd className="text-lg font-medium">{formatPaise(totals.total)}</dd>
          </div>
          <p className="mt-1 text-xs text-content-muted">Inclusive of all taxes</p>
        </div>

        {/* The breakup that appears on the GST invoice. Shown to the paise:
            rounded to whole rupees the components stop summing to the total
            (₹1,895 + ₹47 + ₹47 reads as ₹1,989 against a ₹1,990 charge), which
            on a tax document looks like an error. */}
        <div className="space-y-1.5 border-t border-[var(--color-rule)] pt-3.5 text-xs text-content-muted">
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
        </div>
      </dl>
    </div>
  );
}

function Row({
  label,
  children,
  tone,
  small,
}: {
  label: string;
  children: React.ReactNode;
  tone?: "mulberry";
  small?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className={small ? "" : "text-content-muted"}>{label}</dt>
      <dd className={tone === "mulberry" ? "text-accent-ink" : undefined}>
        {children}
      </dd>
    </div>
  );
}
