import type { ReactNode } from "react";

import { Display, MicroLabel } from "@siumora/ui";

import { CONTACT_COMPLETE, LEGAL_COMPLETE } from "@/lib/legal";

/**
 * Shared shell for policy and content pages.
 *
 * Narrow measure and generous leading — these are read, not skimmed, and a
 * policy nobody can read is a policy nobody follows.
 */
export function PolicyPage({
  title,
  intro,
  updated,
  children,
  statutory = false,
}: {
  title: string;
  intro?: string;
  updated?: string;
  children: ReactNode;
  /** Set when the page carries disclosures required by law. */
  statutory?: boolean;
}) {
  return (
    <div className="mx-auto max-w-2xl px-5 py-16">
      <Display as="h1" size="sm">
        {title}
      </Display>

      {intro && <p className="mt-4 text-content-muted">{intro}</p>}

      {updated && (
        <p className="mt-4">
          <MicroLabel>Last updated {updated}</MicroLabel>
        </p>
      )}

      {/* A statutory page with unfilled entity details is not compliant. Say so
          loudly rather than shipping a page that looks complete. The contact
          block gates publishing; the registration numbers gate opening sale —
          they arrive later, from the registrar, and pending is an honest state
          for a site whose checkout is still paused. */}
      {statutory && !CONTACT_COMPLETE && (
        <p className="mt-8 border border-accent-ink/30 bg-accent/[0.04] p-4 text-sm">
          <strong className="font-medium">Not ready to publish.</strong> The
          registered entity details, GSTIN and grievance officer below are
          unset. They are statutory disclosures and must be filled in before
          this site goes live.
        </p>
      )}
      {statutory && CONTACT_COMPLETE && !LEGAL_COMPLETE && (
        <p className="mt-8 border border-[var(--color-rule)] p-4 text-sm text-content-muted">
          Tax registration in progress. The GSTIN and company registration
          number below are awaited from the registrar; sale does not open
          until they are published here.
        </p>
      )}

      <div className="policy mt-10 space-y-6 text-sm leading-relaxed">
        {children}
      </div>
    </div>
  );
}

export function Section({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2
        className="font-heading text-sm uppercase text-content"
        style={{ letterSpacing: "var(--tracking-caps)" }}
      >
        {heading}
      </h2>
      <div className="mt-3 space-y-3 text-content-muted">{children}</div>
    </section>
  );
}

/** A statutory value, rendered so an unset one is obvious rather than blank. */
export function Disclosure({ label, value }: { label: string; value: string }) {
  const unset = value === "—" || value.trim() === "";
  return (
    <div className="flex flex-wrap justify-between gap-3 border-b border-[var(--color-rule)] py-2.5">
      <dt className="text-content-muted">{label}</dt>
      <dd className={unset ? "text-accent-ink" : "text-content"}>
        {unset ? "To be filled in" : value}
      </dd>
    </div>
  );
}
