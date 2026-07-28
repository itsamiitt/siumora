import { isInStock, lowestPrice, type Product } from "./catalog.ts";

/**
 * Collection filtering and sort.
 *
 * Pure functions over a product list, so the same logic serves a server render,
 * a client-side refine and — when Meilisearch is in front — the facet counts it
 * returns. Filters are read from the URL rather than component state: a filtered
 * collection has to be shareable, bookmarkable and measurable, and state that
 * lives only in a component is none of those.
 *
 * The bands are jewellery bands, not generic quartiles. A shopper looking for
 * something under ₹1,500 is looking for a gift they can send without thinking
 * about it; the band exists because that intent exists, not because the maths
 * divides evenly.
 */

export interface PriceBand {
  readonly key: string;
  readonly label: string;
  /** Inclusive lower bound in paise. */
  readonly from: number;
  /** Exclusive upper bound in paise; omitted means open-ended. */
  readonly to?: number;
}

export const PRICE_BANDS: readonly PriceBand[] = [
  { key: "under-1500", label: "Under ₹1,500", from: 0, to: 150000 },
  { key: "1500-2500", label: "₹1,500 – ₹2,500", from: 150000, to: 250000 },
  { key: "over-2500", label: "Over ₹2,500", from: 250000 },
];

export const SORTS = ["featured", "price-asc", "price-desc", "name"] as const;
export type Sort = (typeof SORTS)[number];

export const SORT_LABELS: Record<Sort, string> = {
  featured: "Featured",
  "price-asc": "Price, low to high",
  "price-desc": "Price, high to low",
  name: "A – Z",
};

export interface FilterState {
  readonly materials: readonly string[];
  readonly bands: readonly string[];
  readonly inStockOnly: boolean;
  readonly sort: Sort;
}

export const NO_FILTERS: FilterState = {
  materials: [],
  bands: [],
  inStockOnly: false,
  sort: "featured",
};

/**
 * Read filters out of URL search params.
 *
 * Unknown values are dropped rather than rejected. A stale link with a
 * discontinued material should show the collection, not an error.
 */
export function parseFilters(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): FilterState {
  const get = (key: string): string[] => {
    if (params instanceof URLSearchParams) {
      const raw = params.get(key);
      return raw ? raw.split(",").filter(Boolean) : [];
    }
    const value = params[key];
    if (Array.isArray(value)) return value;
    return value ? value.split(",").filter(Boolean) : [];
  };

  const sort = get("sort")[0];
  const bandKeys = new Set(PRICE_BANDS.map((band) => band.key));

  return {
    materials: get("material"),
    bands: get("price").filter((key) => bandKeys.has(key)),
    inStockOnly: get("stock")[0] === "in",
    sort: SORTS.includes(sort as Sort) ? (sort as Sort) : "featured",
  };
}

/** Serialise back to a query string. Defaults are omitted, so a clean URL stays clean. */
export function filtersToQuery(filters: FilterState): string {
  const params = new URLSearchParams();
  if (filters.materials.length) params.set("material", filters.materials.join(","));
  if (filters.bands.length) params.set("price", filters.bands.join(","));
  if (filters.inStockOnly) params.set("stock", "in");
  if (filters.sort !== "featured") params.set("sort", filters.sort);
  return params.toString();
}

export interface Facet {
  readonly value: string;
  readonly label: string;
  readonly count: number;
}

/**
 * Facet counts for a product list.
 *
 * Counted against the *unfiltered* list on purpose. Counts that shrink as you
 * select turn every option into a dead end and hide the fact that a filter is
 * even available.
 */
export function materialFacets(products: readonly Product[]): Facet[] {
  const counts = new Map<string, number>();
  for (const product of products) {
    if (!product.material) continue;
    counts.set(product.material, (counts.get(product.material) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function priceFacets(products: readonly Product[]): Facet[] {
  return PRICE_BANDS.map((band) => ({
    value: band.key,
    label: band.label,
    count: products.filter((product) => inBand(product, band)).length,
  })).filter((facet) => facet.count > 0);
}

function inBand(product: Product, band: PriceBand): boolean {
  // Banded on the cheapest variant, which is the price the card shows. Banding
  // on the dearest would hide a ₹1,200 option inside an "over ₹2,500" product.
  const price = lowestPrice(product).selling;
  return price >= band.from && (band.to === undefined || price < band.to);
}

/** Apply the filters, then the sort. */
export function applyFilters(
  products: readonly Product[],
  filters: FilterState,
): Product[] {
  const bands = PRICE_BANDS.filter((band) => filters.bands.includes(band.key));

  const filtered = products.filter((product) => {
    if (filters.inStockOnly && !isInStock(product)) return false;
    if (filters.materials.length && !filters.materials.includes(product.material)) {
      return false;
    }
    // Bands are a union: picking two means "either", not "both", which is the
    // only reading that is not always empty.
    if (bands.length && !bands.some((band) => inBand(product, band))) return false;
    return true;
  });

  return sortProducts(filtered, filters.sort);
}

export function sortProducts(products: readonly Product[], sort: Sort): Product[] {
  const copy = [...products];
  switch (sort) {
    case "price-asc":
      return copy.sort(
        (a, b) => lowestPrice(a).selling - lowestPrice(b).selling,
      );
    case "price-desc":
      return copy.sort(
        (a, b) => lowestPrice(b).selling - lowestPrice(a).selling,
      );
    case "name":
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    case "featured":
    default:
      // Whatever order the catalogue gave us. Merchandising is a decision the
      // shop makes, not one to invent here.
      return copy;
  }
}

/** Whether anything is narrowing the list. Drives the "clear" control. */
export function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.materials.length > 0 ||
    filters.bands.length > 0 ||
    filters.inStockOnly
  );
}
