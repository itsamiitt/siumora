import { cn } from "./cn.ts";

/**
 * The trust row.
 *
 * Sits directly above a pay or add-to-bag button, because that is the moment a
 * first-time Indian shopper decides whether this is a real shop. Every line is
 * a fact the site can actually honour — the returns window, the GST invoice,
 * the payment posture — so the row is assembled from props rather than being a
 * fixed strip of reassuring nouns.
 *
 * Deliberately not badges. Padlock icons and "100% SECURE" seals are the visual
 * grammar of the sites people are afraid of; plain sentences read as calmer and
 * carry more.
 */

export interface TrustItem {
  readonly label: string;
  readonly detail?: string;
}

export interface TrustRowProps {
  items: readonly TrustItem[];
  /** `inline` sits under a button; `stacked` reads as a list in a panel. */
  layout?: "inline" | "stacked";
  className?: string;
}

export function TrustRow({ items, layout = "inline", className }: TrustRowProps) {
  if (items.length === 0) return null;

  return (
    <ul
      className={cn(
        "text-xs text-content-muted",
        layout === "inline"
          ? "flex flex-wrap items-center gap-x-4 gap-y-1.5"
          : "space-y-2",
        className,
      )}
    >
      {items.map((item) => (
        <li key={item.label} className="flex items-baseline gap-1.5">
          {/* The kernel, at rule weight — the mark's own dot, not a tick or a
              shield. One accent per view, and this is not competing for it. */}
          <span
            aria-hidden
            className="inline-block size-1 shrink-0 translate-y-[-2px] rounded-full bg-accent-ink"
          />
          <span>
            {item.label}
            {item.detail && (
              <span className="text-content-faint"> · {item.detail}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
