import type { ReactNode } from "react";

import { cn } from "./cn.ts";

/**
 * One step of a single-page checkout (plan 16 Phase C).
 *
 * Open, it shows its fields. Done and closed, it collapses to one line of
 * what was entered with a "Change" link — Baymard's linear checkout with
 * completed steps summarised, and the shape every Indian one-click checkout
 * uses. Not yet reached, it shows only its title, so the page reads as three
 * short steps rather than one long form.
 */
export function CheckoutStep({
  step,
  title,
  state,
  summary,
  onEdit,
  children,
}: {
  step: number;
  title: string;
  state: "open" | "done" | "upcoming";
  /** The one line shown when done. */
  summary?: ReactNode;
  onEdit?: () => void;
  children: ReactNode;
}) {
  const headingId = `checkout-step-${step}`;
  return (
    <section aria-labelledby={headingId} className="border-b border-[var(--color-rule)] py-5 first:pt-0 lg:py-6">
      <div className="flex items-baseline gap-3">
        <span
          aria-hidden
          className={cn(
            "font-display text-xl font-light",
            state === "upcoming" ? "text-content-faint" : "text-accent-ink",
          )}
        >
          {step}
        </span>
        <h2
          id={headingId}
          className={cn(
            "flex-1 font-body text-[11px] font-medium uppercase",
            state === "upcoming" ? "text-content-faint" : "text-content-muted",
          )}
          style={{ letterSpacing: "var(--tracking-caps)" }}
        >
          {title}
        </h2>
        {state === "done" && onEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Change ${title.toLowerCase()}`}
            className="min-h-11 text-sm text-content-muted underline-offset-4 hover:text-accent-ink hover:underline"
          >
            Change
          </button>
        )}
      </div>
      {state === "done" && summary && (
        <div className="mt-1 pl-7 text-sm text-content-muted">{summary}</div>
      )}
      {state === "open" && <div className="mt-4 lg:mt-5">{children}</div>}
    </section>
  );
}
