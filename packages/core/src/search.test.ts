import assert from "node:assert/strict";
import { test } from "node:test";

import { productSchema, type Product } from "./catalog.ts";
import { editDistance, expandTerm, searchProducts, tokenise } from "./search.ts";

function make(overrides: Record<string, unknown>): Product {
  return productSchema.parse({
    id: "p",
    handle: "h",
    title: "Petal Studs",
    subtitle: "The four-circle mark, worn small.",
    description: "925 sterling silver with 18k gold PVD.",
    hsn: "7113",
    gstSlab: 5,
    material: "925 sterling silver · 18k gold PVD",
    images: [{ url: "/i.svg", alt: "a", width: 10, height: 10 }],
    variants: [
      {
        id: "v",
        sku: "SKU-1",
        title: "Gold",
        price: { mrp: 100, selling: 100 },
        inventory: 1,
      },
    ],
    collections: ["everyday"],
    ...overrides,
  });
}

const studs = make({ id: "1", handle: "petal-studs", title: "Petal Studs" });
const hoops = make({
  id: "2",
  handle: "jaali-hoops",
  title: "Jaali Hoops",
  subtitle: "The lattice, opened out.",
});
const pendant = make({
  id: "3",
  handle: "kernel-pendant",
  title: "Kernel Pendant",
  subtitle: "One stone, set dead centre.",
  collections: ["gifting"],
});
const band = make({
  id: "4",
  handle: "tuesday-band",
  title: "Tuesday Band",
  subtitle: "For the Tuesday, not the wedding.",
});

const catalog = [studs, hoops, pendant, band];
const handles = (q: string) => searchProducts(catalog, q).map((h) => h.product.handle);

test("finds a product by its title", () => {
  assert.deepEqual(handles("petal studs"), ["petal-studs"]);
});

test("matches Hinglish and transliterated terms", () => {
  // A shopper searching "jhumka" wants earrings; nothing in the catalogue
  // contains that string.
  assert.ok(handles("jhumka").includes("petal-studs"));
  assert.ok(handles("bali").includes("petal-studs"));
  assert.ok(handles("haar").includes("kernel-pendant"));
  assert.ok(handles("anguthi").includes("tuesday-band"));
});

test("expands synonyms symmetrically", () => {
  assert.ok(expandTerm("jhumka").has("earring"));
  assert.ok(expandTerm("earring").has("jhumka"));
  assert.ok(expandTerm("chandi").has("silver"));
});

test("tolerates typos in longer words", () => {
  assert.ok(handles("pendnat").includes("kernel-pendant"));
  assert.ok(handles("sterlng").length > 0);
});

test("requires every token to match, so extra words narrow", () => {
  const gold = handles("gold");
  const goldPendant = handles("gold pendant");

  assert.ok(gold.length > goldPendant.length, "adding a word should narrow");
  assert.deepEqual(goldPendant, ["kernel-pendant"]);
});

test("ranks a title match above a description match", () => {
  const hits = searchProducts(catalog, "band");
  assert.equal(hits[0]?.product.handle, "tuesday-band");
});

test("returns nothing for an unmatched query", () => {
  assert.deepEqual(handles("sofa"), []);
});

test("returns nothing for an empty query rather than everything", () => {
  assert.deepEqual(handles(""), []);
  assert.deepEqual(handles("   "), []);
});

test("ignores punctuation and case", () => {
  assert.deepEqual(handles("PETAL, studs!"), ["petal-studs"]);
});

test("tokenise drops single characters and punctuation", () => {
  assert.deepEqual(tokenise("a gold  ring!"), ["gold", "ring"]);
});

test("edit distance bails out past the bound", () => {
  assert.equal(editDistance("gold", "gold"), 0);
  assert.equal(editDistance("gold", "gld"), 1);
  assert.ok(editDistance("gold", "silverware", 2) > 2);
});

test("short words must match exactly, so typos do not over-match", () => {
  // "bald" must not fuzzy-match "gold" — a 4-letter word gets no tolerance.
  assert.deepEqual(handles("bald"), []);
});
