import assert from "node:assert/strict";
import { test } from "node:test";

import { productSchema, type Product } from "./catalog.ts";
import {
  NO_FILTERS,
  PRICE_BANDS,
  applyFilters,
  filtersToQuery,
  hasActiveFilters,
  materialFacets,
  parseFilters,
  priceFacets,
  sortProducts,
} from "./facets.ts";

let counter = 0;

function product(overrides: {
  title: string;
  material: string;
  selling: number;
  inventory?: number;
}): Product {
  counter += 1;
  return productSchema.parse({
    id: `p${counter}`,
    handle: `handle-${counter}`,
    title: overrides.title,
    subtitle: "",
    description: "",
    hsn: "7113",
    gstSlab: 5,
    material: overrides.material,
    piercedJewellery: false,
    images: [{ url: "/x.svg", alt: "x", width: 10, height: 10 }],
    collections: ["everyday"],
    variants: [
      {
        id: `v${counter}`,
        sku: `SKU-${counter}`,
        title: "One",
        price: { mrp: overrides.selling, selling: overrides.selling },
        inventory: overrides.inventory ?? 5,
      },
    ],
  });
}

const CATALOGUE = [
  product({ title: "Cheap silver", material: "925 silver", selling: 120000 }),
  product({ title: "Mid silver", material: "925 silver", selling: 190000 }),
  product({ title: "Dear gold", material: "18k gold PVD", selling: 320000 }),
  product({ title: "Sold out gold", material: "18k gold PVD", selling: 210000, inventory: 0 }),
];

test("reads filters out of a query string", () => {
  const filters = parseFilters(
    new URLSearchParams("material=925 silver&price=under-1500&stock=in&sort=price-asc"),
  );
  assert.deepEqual(filters.materials, ["925 silver"]);
  assert.deepEqual(filters.bands, ["under-1500"]);
  assert.equal(filters.inStockOnly, true);
  assert.equal(filters.sort, "price-asc");
});

test("reads filters out of a Next searchParams object", () => {
  const filters = parseFilters({ price: "over-2500", sort: "name" });
  assert.deepEqual(filters.bands, ["over-2500"]);
  assert.equal(filters.sort, "name");
});

test("drops values it does not recognise rather than failing", () => {
  // A stale link with a discontinued band should show the collection, not an
  // error page.
  const filters = parseFilters(new URLSearchParams("price=under-99&sort=random"));
  assert.deepEqual(filters.bands, []);
  assert.equal(filters.sort, "featured");
});

test("round-trips through a query string", () => {
  const filters = parseFilters(
    new URLSearchParams("material=925 silver&price=under-1500&stock=in&sort=name"),
  );
  assert.deepEqual(parseFilters(new URLSearchParams(filtersToQuery(filters))), filters);
});

test("leaves a clean URL clean", () => {
  assert.equal(filtersToQuery(NO_FILTERS), "");
});

test("counts materials against the whole list", () => {
  const facets = materialFacets(CATALOGUE);
  assert.deepEqual(
    facets.map((f) => [f.value, f.count]),
    [
      ["18k gold PVD", 2],
      ["925 silver", 2],
    ],
  );
});

test("bands a product on its cheapest variant", () => {
  // Banding on the dearest would bury a ₹1,200 option inside "over ₹2,500".
  const wide = productSchema.parse({
    ...CATALOGUE[0],
    id: "wide",
    handle: "wide",
    variants: [
      { id: "a", sku: "A", title: "Silver", price: { mrp: 120000, selling: 120000 }, inventory: 3 },
      { id: "b", sku: "B", title: "Gold", price: { mrp: 320000, selling: 320000 }, inventory: 3 },
    ],
  });

  const facets = priceFacets([wide]);
  assert.deepEqual(
    facets.map((f) => f.value),
    ["under-1500"],
  );
});

test("hides bands nothing falls into", () => {
  const facets = priceFacets([CATALOGUE[0]!]);
  assert.equal(facets.length, 1);
});

test("filters by material", () => {
  const result = applyFilters(CATALOGUE, {
    ...NO_FILTERS,
    materials: ["925 silver"],
  });
  assert.deepEqual(result.map((p) => p.title), ["Cheap silver", "Mid silver"]);
});

test("treats two price bands as either, not both", () => {
  // The intersection is always empty, so an AND reading would silently return
  // nothing every time someone ticked a second box.
  const result = applyFilters(CATALOGUE, {
    ...NO_FILTERS,
    bands: ["under-1500", "over-2500"],
  });
  assert.deepEqual(result.map((p) => p.title), ["Cheap silver", "Dear gold"]);
});

test("combines different filters as and", () => {
  const result = applyFilters(CATALOGUE, {
    ...NO_FILTERS,
    materials: ["18k gold PVD"],
    bands: ["over-2500"],
  });
  assert.deepEqual(result.map((p) => p.title), ["Dear gold"]);
});

test("hides sold-out products only when asked", () => {
  assert.equal(applyFilters(CATALOGUE, NO_FILTERS).length, 4);
  assert.equal(
    applyFilters(CATALOGUE, { ...NO_FILTERS, inStockOnly: true }).length,
    3,
  );
});

test("sorts by price in both directions", () => {
  assert.deepEqual(
    sortProducts(CATALOGUE, "price-asc").map((p) => p.title),
    ["Cheap silver", "Mid silver", "Sold out gold", "Dear gold"],
  );
  assert.deepEqual(
    sortProducts(CATALOGUE, "price-desc").map((p) => p.title)[0],
    "Dear gold",
  );
});

test("featured keeps the catalogue's own order", () => {
  assert.deepEqual(
    sortProducts(CATALOGUE, "featured").map((p) => p.title),
    CATALOGUE.map((p) => p.title),
  );
});

test("sorting never mutates the list it was given", () => {
  const before = CATALOGUE.map((p) => p.title);
  sortProducts(CATALOGUE, "price-desc");
  assert.deepEqual(CATALOGUE.map((p) => p.title), before);
});

test("knows when something is narrowing the list", () => {
  assert.equal(hasActiveFilters(NO_FILTERS), false);
  // Sort alone is not a filter — offering to "clear" it would be confusing.
  assert.equal(hasActiveFilters({ ...NO_FILTERS, sort: "price-asc" }), false);
  assert.equal(hasActiveFilters({ ...NO_FILTERS, inStockOnly: true }), true);
});

test("every band is reachable and they do not overlap", () => {
  for (let i = 1; i < PRICE_BANDS.length; i += 1) {
    assert.equal(PRICE_BANDS[i - 1]!.to, PRICE_BANDS[i]!.from);
  }
  assert.equal(PRICE_BANDS[PRICE_BANDS.length - 1]!.to, undefined);
});
