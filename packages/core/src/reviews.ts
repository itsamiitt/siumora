import { z } from "zod";

/**
 * Product reviews and their aggregation.
 *
 * Only verified buyers can review, so the rating means something and the
 * `Review` schema can honestly claim it. Unverified reviews are still stored —
 * a real customer who bought elsewhere may write one — but they are excluded
 * from the aggregate that feeds rich results.
 */

export const reviewSchema = z.object({
  id: z.string().min(1),
  productHandle: z.string().min(1),
  /** Whole stars, 1–5. Half stars complicate the schema for no real gain. */
  rating: z.number().int().min(1).max(5),
  title: z.string().max(80),
  body: z.string().max(2000),
  authorName: z.string().min(1).max(60),
  /** True when the reviewer's order for this product was delivered. */
  verifiedBuyer: z.boolean(),
  createdAt: z.string(),
});

export type Review = z.infer<typeof reviewSchema>;

export interface RatingSummary {
  /** Mean rating rounded to one decimal, or null when there is nothing to average. */
  readonly average: number | null;
  readonly count: number;
  /** Count per star, indexed 1–5. */
  readonly distribution: Readonly<Record<1 | 2 | 3 | 4 | 5, number>>;
}

const EMPTY_DISTRIBUTION = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as const;

/**
 * Aggregate ratings from verified buyers only.
 *
 * Returns `average: null` rather than 0 for an empty set. Zero is a real
 * rating; conflating "nobody has rated this" with "everybody rated it zero"
 * would render a one-star product and emit a false claim in structured data.
 */
export function summariseRatings(reviews: readonly Review[]): RatingSummary {
  const verified = reviews.filter((review) => review.verifiedBuyer);

  if (verified.length === 0) {
    return { average: null, count: 0, distribution: EMPTY_DISTRIBUTION };
  }

  const distribution = { ...EMPTY_DISTRIBUTION } as Record<1 | 2 | 3 | 4 | 5, number>;
  let total = 0;

  for (const review of verified) {
    const star = review.rating as 1 | 2 | 3 | 4 | 5;
    distribution[star] += 1;
    total += review.rating;
  }

  return {
    average: Math.round((total / verified.length) * 10) / 10,
    count: verified.length,
    distribution,
  };
}

/**
 * Whether a product may carry AggregateRating in its structured data.
 *
 * Google treats an AggregateRating with no reviews as invalid, and emitting one
 * risks the rich result being dropped for the whole page. The check lives here
 * so the JSON-LD builder cannot forget it.
 */
export function canEmitAggregateRating(summary: RatingSummary): boolean {
  return summary.count > 0 && summary.average !== null;
}

/** Newest first — the order a shopper expects and the one that shows drift. */
export function sortByNewest(reviews: readonly Review[]): Review[] {
  return [...reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
