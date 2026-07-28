import { discountPercent, formatPaise, noCostEmiPerMonth } from "@siumora/in-locale";

import { cn } from "./cn.ts";

/**
 * The Indian price convention, in one place:
 *
 *   MRP struck through · selling price · "% off" chip · tax-inclusive note
 *
 * Displayed prices are always inclusive of all taxes — that is both the legal
 * requirement and what shoppers expect, so the note is not optional copy.
 */
export interface PriceProps {
  /** Maximum retail price in paise. */
  mrp: number;
  /** Selling price in paise. */
  selling: number;
  size?: "sm" | "md" | "lg";
  /** Show the "Inclusive of all taxes" line. On by default for PDPs. */
  showTaxNote?: boolean;
  /**
   * Show a no-cost EMI line when the price clears the threshold.
   * Pass the tenure in months; omit to hide.
   */
  emiMonths?: number;
  /** Minimum selling price in paise before an EMI line is offered. */
  emiThreshold?: number;
  className?: string;
}

const SELLING_SIZE = {
  sm: "text-base",
  md: "text-xl",
  lg: "text-2xl",
} as const;

export function Price({
  mrp,
  selling,
  size = "md",
  showTaxNote = false,
  emiMonths,
  emiThreshold = 300000,
  className,
}: PriceProps) {
  const off = discountPercent(mrp, selling);
  const showEmi = emiMonths !== undefined && selling >= emiThreshold;

  return (
    <div className={cn("font-body", className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cn("font-medium text-content", SELLING_SIZE[size])}>
          {formatPaise(selling)}
        </span>

        {off > 0 && (
          <>
            <span className="text-sm text-content-faint line-through">
              {formatPaise(mrp)}
            </span>
            <span
              className="text-[11px] font-medium uppercase text-accent-ink"
              style={{ letterSpacing: "var(--tracking-caps)" }}
            >
              {off}% off
            </span>
          </>
        )}
      </div>

      {showTaxNote && (
        <p className="mt-1 text-xs text-content-muted">Inclusive of all taxes</p>
      )}

      {showEmi && (
        <p className="mt-1 text-xs text-content-muted">
          or {formatPaise(noCostEmiPerMonth(selling, emiMonths))}/mo · No-Cost EMI
        </p>
      )}
    </div>
  );
}
