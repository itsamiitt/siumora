"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { ReactNode } from "react";

import {
  NO_FILTERS,
  SORTS,
  SORT_LABELS,
  filtersToQuery,
  hasActiveFilters,
  parseFilters,
  type Facet,
  type FilterState,
  type Sort,
} from "@siumora/core/facets";
import { MicroLabel } from "@siumora/ui";

interface ProductFiltersProps {
  materials: readonly Facet[];
  prices: readonly Facet[];
  total: number;
  showing: number;
}

/** Every refinement lives in the URL, including changes made in the mobile drawer. */
export function ProductFilters({
  materials,
  prices,
  total,
  showing,
}: ProductFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const filters = parseFilters(new URLSearchParams(params.toString()));

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      closeButton.current?.focus();
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = previousOverflow;
      };
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  function push(next: FilterState) {
    const query = filtersToQuery(next);
    startTransition(() => {
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  function toggle(key: "materials" | "bands", value: string) {
    const current = filters[key];
    push({
      ...filters,
      [key]: current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value],
    });
  }

  const selected = [
    ...filters.materials.map(
      (value) => materials.find((facet) => facet.value === value)?.label ?? value,
    ),
    ...filters.bands.map(
      (value) => prices.find((facet) => facet.value === value)?.label ?? value,
    ),
    ...(filters.inStockOnly ? ["In stock"] : []),
    ...(filters.sort !== "featured" ? [SORT_LABELS[filters.sort]] : []),
  ];
  const hasSelection = hasActiveFilters(filters) || filters.sort !== "featured";
  const options = { materials, prices, filters, pending, toggle, push };

  return (
    <div className="mt-10 border-y border-[var(--color-rule)] py-4" data-pending={pending ? "" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2 md:hidden">
        <span className="text-sm text-content-muted" aria-live="polite">
          {showing} of {total} {total === 1 ? "piece" : "pieces"}
        </span>
        <button
          ref={trigger}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="collection-filters-dialog"
          onClick={() => setOpen(true)}
          className="ml-auto min-h-11 border border-content/25 px-4 text-sm hover:border-accent-ink hover:text-accent-ink"
        >
          Filter &amp; sort{selected.length ? ` (${selected.length})` : ""}
        </button>
      </div>

      <div className="hidden flex-wrap items-center gap-x-8 gap-y-5 md:flex">
        <FilterOptions {...options} sortId="collection-sort-desktop" />
      </div>

      <dialog
        id="collection-filters-dialog"
        ref={dialog}
        aria-labelledby="collection-filters-title"
        onClose={() => {
          setOpen(false);
          if (window.matchMedia("(max-width: 767px)").matches) trigger.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
        className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-lg border border-[var(--color-rule)] bg-ground px-5 pb-6 pt-5 text-content shadow-xl backdrop:bg-content/50 md:hidden"
      >
        <div className="flex items-center justify-between gap-4 border-b border-[var(--color-rule)] pb-4">
          <h2 id="collection-filters-title" className="font-heading text-sm uppercase">
            Filter &amp; sort
          </h2>
          <button
            ref={closeButton}
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-11 px-2 text-sm underline underline-offset-4"
          >
            Close
          </button>
        </div>
        <div className="grid gap-6 py-6">
          <FilterOptions {...options} sortId="collection-sort-mobile" mobile />
        </div>
        <div className="flex items-center gap-4 border-t border-[var(--color-rule)] pt-4">
          {hasSelection && (
            <button type="button" onClick={() => push(NO_FILTERS)} className="min-h-11 text-sm underline underline-offset-4">
              Reset
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => setOpen(false)}
            className="ml-auto min-h-11 bg-content px-5 text-sm text-ivory disabled:opacity-60"
          >
            Show {showing} {showing === 1 ? "piece" : "pieces"}
          </button>
        </div>
      </dialog>

      {hasSelection && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-content-muted">
          <span aria-live="polite">Applied: {selected.join(", ")}</span>
          <button
            type="button"
            onClick={() => push(NO_FILTERS)}
            className="min-h-11 underline underline-offset-4 hover:text-accent-ink"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

function FilterOptions({
  materials,
  prices,
  filters,
  pending,
  toggle,
  push,
  sortId,
  mobile = false,
}: {
  materials: readonly Facet[];
  prices: readonly Facet[];
  filters: FilterState;
  pending: boolean;
  toggle: (key: "materials" | "bands", value: string) => void;
  push: (next: FilterState) => void;
  sortId: string;
  mobile?: boolean;
}) {
  return (
    <>
      {materials.length > 1 && (
        <Group label="Material">
          {materials.map((facet) => (
            <Chip
              key={facet.value}
              active={filters.materials.includes(facet.value)}
              disabled={pending}
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
              disabled={pending}
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
          disabled={pending}
          onClick={() => push({ ...filters, inStockOnly: !filters.inStockOnly })}
        >
          In stock
        </Chip>
      </Group>

      <div className={mobile ? "grid gap-2" : "ml-auto flex items-center gap-3"}>
        <label htmlFor={sortId} className={mobile ? "text-sm text-content-muted" : "sr-only"}>
          Sort
        </label>
        <select
          id={sortId}
          value={filters.sort}
          disabled={pending}
          onChange={(event) => push({ ...filters, sort: event.target.value as Sort })}
          className="min-h-11 border border-content/20 bg-ground px-3 text-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent-ink"
        >
          {SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {SORT_LABELS[sort]}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
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
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={
        "min-h-11 border px-3.5 text-sm transition-colors disabled:opacity-60 " +
        (active
          ? "border-accent-ink bg-accent/5 text-accent-ink"
          : "border-content/20 hover:border-accent-ink hover:text-accent-ink")
      }
    >
      {children}
    </button>
  );
}

function Count({ children }: { children: ReactNode }) {
  return <span className="text-content-faint">{children}</span>;
}
