"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import {
  SORTS,
  SORT_LABELS,
  filtersToQuery,
  hasActiveFilters,
  parseFilters,
  type Facet,
  type Sort,
} from "@siumora/core/facets";
import { MicroLabel } from "@siumora/ui";

/**
 * Collection refine.
 *
 * The URL is the state. Selecting a material pushes a new query string and the
 * server re-renders the grid — which means a filtered collection can be shared,
 * bookmarked, opened in a second tab and measured in analytics, none of which
 * are true of a filter that lives in component state.
 *
 * Counts come from the unfiltered list, so an option never silently reads zero
 * because of a choice made two filters ago.
 */
export function ProductFilters({
  materials,
  prices,
  total,
  showing,
}: {
  materials: readonly Facet[];
  prices: readonly Facet[];
  total: number;
  showing: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const filters = parseFilters(new URLSearchParams(params.toString()));

  function push(next: Parameters<typeof filtersToQuery>[0]) {
    const query = filtersToQuery(next);
    startTransition(() => {
      // `scroll: false` — a refine happens beside the grid, and jumping to the
      // top of the page loses the reader's place for no reason.
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  const toggle = (key: "materials" | "bands", value: string) => {
    const current = filters[key];
    push({
      ...filters,
      [key]: current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value],
    });
  };

  return (
    <div
      className="mt-10 border-y border-[var(--color-rule)] py-5"
      data-pending={pending ? "" : undefined}
    >
      <div className="flex flex-wrap items-center gap-x-8 gap-y-5">
        {materials.length > 1 && (
          <Group label="Material">
            {materials.map((facet) => (
              <Chip
                key={facet.value}
                active={filters.materials.includes(facet.value)}
                onClick={() => toggle("materials", facet.value)}
              >
                {facet.label} <Count>{facet.count}</Count>
              </Chip>
            ))}
          </Group>
        )}

        {prices.length > 1 && (
          <Group label="Price">
            {prices.map((facet) => (
              <Chip
                key={facet.value}
                active={filters.bands.includes(facet.value)}
                onClick={() => toggle("bands", facet.value)}
              >
                {facet.label} <Count>{facet.count}</Count>
              </Chip>
            ))}
          </Group>
        )}

        <Group label="Availability">
          <Chip
            active={filters.inStockOnly}
            onClick={() => push({ ...filters, inStockOnly: !filters.inStockOnly })}
          >
            In stock
          </Chip>
        </Group>

        <div className="ml-auto flex items-center gap-3">
          <label htmlFor="sort" className="sr-only">
            Sort
          </label>
          <select
            id="sort"
            value={filters.sort}
            onChange={(event) =>
              push({ ...filters, sort: event.target.value as Sort })
            }
            className="h-9 border border-content/20 bg-transparent px-2 text-sm outline-none focus:border-accent-ink"
          >
            {SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {hasActiveFilters(filters) && (
        <p className="mt-4 flex items-center gap-4 text-xs text-content-muted">
          <span aria-live="polite">
            {showing} of {total} pieces
          </span>
          <button
            type="button"
            onClick={() => push({ ...filters, materials: [], bands: [], inStockOnly: false })}
            className="border-b border-content/40 pb-0.5 transition-colors hover:border-accent-ink hover:text-accent-ink"
          >
            Clear
          </button>
        </p>
      )}
    </div>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2.5">
      <legend className="sr-only">{label}</legend>
      <MicroLabel className="mr-1 text-content-faint">{label}</MicroLabel>
      {children}
    </fieldset>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        "border px-3.5 py-1.5 text-sm transition-colors " +
        (active
          ? "border-accent-ink bg-accent/5 text-accent-ink"
          : "border-content/20 hover:border-accent-ink hover:text-accent-ink")
      }
    >
      {children}
    </button>
  );
}

/** The count, at rule weight — information, not emphasis. */
function Count({ children }: { children: React.ReactNode }) {
  return <span className="text-content-faint">{children}</span>;
}
