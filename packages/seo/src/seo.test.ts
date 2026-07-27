import assert from "node:assert/strict";
import { test } from "node:test";

import { productSchema, type Collection, type Product } from "@siumora/core";

import { buildLlmsTxt, buildRobots, buildSitemap } from "./discovery.ts";
import { breadcrumbJsonLd, productJsonLd } from "./jsonld.ts";
import { productMetadata, truncate } from "./metadata.ts";

const product: Product = productSchema.parse({
  id: "prod_1",
  handle: "petal-studs",
  title: "Petal Studs",
  subtitle: "The four-circle mark, worn small.",
  description: "925 sterling silver with 18k gold PVD.",
  hsn: "7113",
  gstSlab: 5,
  material: "925 sterling silver · 18k gold PVD",
  images: [
    { url: "/catalog/petal-studs.svg", alt: "Petal Studs", width: 1200, height: 1500 },
  ],
  variants: [
    {
      id: "v1",
      sku: "SIU-PS-GLD",
      title: "Gold",
      price: { mrp: 249000, selling: 199000 },
      inventory: 4,
    },
  ],
  collections: ["everyday"],
});

const soldOut: Product = productSchema.parse({
  ...product,
  id: "prod_2",
  handle: "sold-out",
  variants: [{ ...product.variants[0]!, inventory: 0 }],
});

const collection: Collection = {
  id: "col_1",
  handle: "everyday",
  title: "Everyday",
  description: "Made to be worn, not stored.",
};

test("emits price as decimal rupees, not paise", () => {
  const ld = productJsonLd(product) as unknown as { offers: { price: string } };
  // 199000 paise is ₹1,990.00 — emitting the paise would advertise ₹1,99,000.
  assert.equal(ld.offers.price, "1990.00");
});

test("marks availability from real stock", () => {
  const inStock = productJsonLd(product) as unknown as { offers: { availability: string } };
  const out = productJsonLd(soldOut) as unknown as { offers: { availability: string } };
  assert.match(inStock.offers.availability, /InStock/);
  assert.match(out.offers.availability, /OutOfStock/);
});

test("sets priceValidUntil a year out", () => {
  const ld = productJsonLd(product, { now: new Date("2026-07-27T00:00:00Z") }) as unknown as {
    offers: { priceValidUntil: string };
  };
  assert.equal(ld.offers.priceValidUntil, "2027-07-27");
});

test("makes every JSON-LD url absolute", () => {
  const ld = productJsonLd(product) as unknown as { url: string; image: string[] };
  assert.match(ld.url, /^https?:\/\//);
  for (const image of ld.image) assert.match(image, /^https?:\/\//);
});

test("numbers breadcrumbs from one", () => {
  const ld = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Everyday", path: "/collections/everyday" },
  ]) as unknown as { itemListElement: Array<{ position: number }> };

  assert.deepEqual(
    ld.itemListElement.map((i) => i.position),
    [1, 2],
  );
});

test("truncates on a word boundary", () => {
  assert.equal(truncate("short", 60), "short");
  const long = truncate("a".repeat(40) + " tail words here", 30);
  assert.ok(long.length <= 30);
  assert.ok(long.endsWith("…"));
});

test("keeps metadata within SERP limits", () => {
  const meta = productMetadata(product);
  assert.ok(meta.title.length <= 60, `title too long: ${meta.title.length}`);
  assert.ok(meta.description.length <= 160);
  assert.match(meta.alternates.canonical, /\/products\/petal-studs$/);
});

test("never uses the forbidden brand words", () => {
  const meta = productMetadata(product);
  const text = `${meta.title} ${meta.description}`.toLowerCase();
  for (const banned of ["bridal", "luxury", "exclusive", "premium", "trousseau"]) {
    assert.ok(!text.includes(banned), `metadata used "${banned}"`);
  }
});

test("sitemap covers catalogue pages and excludes private ones", () => {
  const entries = buildSitemap([product], [collection]);
  const urls = entries.map((e) => e.url);

  assert.ok(urls.some((u) => u.endsWith("/products/petal-studs")));
  assert.ok(urls.some((u) => u.endsWith("/collections/everyday")));
  for (const path of ["/cart", "/checkout", "/account"]) {
    assert.ok(!urls.some((u) => u.includes(path)), `sitemap listed ${path}`);
  }
});

test("robots blocks private paths but allows AI crawlers", () => {
  const robots = buildRobots();
  const wildcard = robots.rules[0]!;
  assert.deepEqual(wildcard.disallow, ["/cart", "/checkout", "/account", "/api/"]);

  const ai = robots.rules[1]!;
  assert.ok(Array.isArray(ai.userAgent) && ai.userAgent.includes("GPTBot"));
  assert.deepEqual(ai.allow, ["/"]);
});

test("preview deployments disallow everything", () => {
  const robots = buildRobots({ isPreview: true });
  assert.deepEqual(robots.rules[0]?.disallow, ["/"]);
  assert.equal(robots.rules[0]?.allow, undefined);
});

test("llms.txt states the facts an engine needs", () => {
  const text = buildLlmsTxt([product], [collection]);
  assert.match(text, /# Siumora/);
  assert.match(text, /Petal Studs/);
  assert.match(text, /₹1,990/);
  assert.match(text, /include GST/);
  assert.match(text, /7 days/);
});
