import assert from "node:assert/strict";
import { test } from "node:test";

import { CATALOG } from "./seed.ts";

/**
 * Launch-gate assertion: the seed ships no fabricated social proof.
 *
 * A seeded review renders on the PDP and emits aggregateRating/Review
 * structured data — fake verified five-star reviews in Google rich snippets
 * for a store with zero customers. Reviews only ever come from customers;
 * the seed clearing the reviews table is cleanup, not content.
 */
test("the seed ships no fabricated reviews, ratings or testimonials", () => {
  const flattened = JSON.stringify(CATALOG);
  assert.ok(!flattened.includes("verifiedBuyer"), "seed carries verifiedBuyer");
  assert.ok(!flattened.includes("authorName"), "seed carries a review author");
  assert.ok(!flattened.includes('"rating"'), "seed carries a rating");
  for (const entry of CATALOG) {
    assert.ok(!("reviews" in entry), `${entry.handle} seeds reviews`);
  }
});
