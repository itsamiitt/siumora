import { FREE_SHIPPING_THRESHOLD, amountToFreeShipping } from "@siumora/core";
import { formatPaise } from "@siumora/in-locale";

/**
 * Progress toward free shipping.
 *
 * Shows the gap in rupees rather than a bare percentage — the number the
 * shopper needs is "how much more", not "how far along".
 */
export function FreeShippingProgress({ subtotal }: { subtotal: number }) {
  const remaining = amountToFreeShipping(subtotal);
  const progress = Math.min(100, (subtotal / FREE_SHIPPING_THRESHOLD) * 100);
  const earned = remaining === 0;

  return (
    <div>
      <p className="text-sm">
        {earned ? (
          <span className="text-mulberry">Shipping is on us.</span>
        ) : (
          <>
            <span className="text-ink-muted">Add </span>
            <span className="font-medium">{formatPaise(remaining)}</span>
            <span className="text-ink-muted"> for free shipping</span>
          </>
        )}
      </p>

      <div
        className="mt-2.5 h-px w-full bg-ink/12"
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progress toward free shipping"
      >
        <div
          className="h-px bg-mulberry transition-[width] duration-500 ease-[var(--ease-siumora)]"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
