import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canEmitAggregateRating,
  reviewSchema,
  sortByNewest,
  summariseRatings,
  type Review,
} from "./reviews.ts";

function review(overrides: Partial<Review> = {}): Review {
  return reviewSchema.parse({
    id: "r1",
    productHandle: "petal-studs",
    rating: 5,
    title: "Lovely",
    body: "Wear it every day.",
    authorName: "Asha",
    verifiedBuyer: true,
    createdAt: "2026-07-01T00:00:00Z",
    ...overrides,
  });
}

test("returns null rather than zero when nothing is rated", () => {
  // Zero is a real rating; conflating the two would render a one-star product.
  const summary = summariseRatings([]);
  assert.equal(summary.average, null);
  assert.equal(summary.count, 0);
});

test("averages verified ratings to one decimal", () => {
  const summary = summariseRatings([
    review({ id: "a", rating: 5 }),
    review({ id: "b", rating: 4 }),
    review({ id: "c", rating: 4 }),
  ]);
  assert.equal(summary.average, 4.3);
  assert.equal(summary.count, 3);
});

test("excludes unverified reviews from the aggregate", () => {
  const summary = summariseRatings([
    review({ id: "a", rating: 5, verifiedBuyer: true }),
    review({ id: "b", rating: 1, verifiedBuyer: false }),
  ]);
  // The one-star unverified review must not drag the published rating down.
  assert.equal(summary.average, 5);
  assert.equal(summary.count, 1);
});

test("counts the distribution per star", () => {
  const summary = summariseRatings([
    review({ id: "a", rating: 5 }),
    review({ id: "b", rating: 5 }),
    review({ id: "c", rating: 3 }),
  ]);
  assert.equal(summary.distribution[5], 2);
  assert.equal(summary.distribution[3], 1);
  assert.equal(summary.distribution[1], 0);
});

test("refuses AggregateRating when there is nothing to aggregate", () => {
  // Emitting it empty is an invalid structured-data claim and can cost the
  // rich result for the whole page.
  assert.equal(canEmitAggregateRating(summariseRatings([])), false);
  assert.equal(
    canEmitAggregateRating(
      summariseRatings([review({ verifiedBuyer: false })]),
    ),
    false,
  );
  assert.equal(canEmitAggregateRating(summariseRatings([review()])), true);
});

test("rejects ratings outside one to five", () => {
  assert.throws(() => review({ rating: 0 }));
  assert.throws(() => review({ rating: 6 }));
  assert.throws(() => review({ rating: 4.5 }));
});

test("sorts newest first", () => {
  const sorted = sortByNewest([
    review({ id: "old", createdAt: "2026-01-01T00:00:00Z" }),
    review({ id: "new", createdAt: "2026-07-01T00:00:00Z" }),
  ]);
  assert.deepEqual(sorted.map((r) => r.id), ["new", "old"]);
});
