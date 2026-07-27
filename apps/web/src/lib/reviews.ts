import "server-only";

import { reviewSchema, sortByNewest, type Review } from "@siumora/core";

/**
 * Review source.
 *
 * A fixture for now, validated at load so a malformed rating fails the build
 * rather than rendering a broken star row. The `reviews` module in apps/api
 * replaces the body of these functions.
 */

const RAW: unknown[] = [
  {
    id: "rev_1",
    productHandle: "petal-studs",
    rating: 5,
    title: "Wear them every day",
    body: "Bought these after my first salary. Have not taken them off since — shower, gym, everything. Still bright.",
    authorName: "Asha M.",
    verifiedBuyer: true,
    createdAt: "2026-07-12T00:00:00Z",
  },
  {
    id: "rev_2",
    productHandle: "petal-studs",
    rating: 4,
    title: "Smaller than I expected",
    body: "Lovely finish and the packing is genuinely gift-ready. Slightly smaller than they look in photos, but that grew on me.",
    authorName: "Riya S.",
    verifiedBuyer: true,
    createdAt: "2026-06-28T00:00:00Z",
  },
  {
    id: "rev_3",
    productHandle: "kernel-pendant",
    rating: 5,
    title: "Gifted it, then bought my own",
    body: "Gave this to my sister for her exam result and ended up ordering the same one. The chain length is right for daily wear.",
    authorName: "Nikhil P.",
    verifiedBuyer: true,
    createdAt: "2026-07-05T00:00:00Z",
  },
  {
    id: "rev_4",
    productHandle: "jaali-hoops",
    rating: 4,
    title: "Light enough to forget",
    body: "I usually cannot wear hoops all day. These I forget I have on.",
    authorName: "Fatima K.",
    verifiedBuyer: true,
    createdAt: "2026-07-18T00:00:00Z",
  },
];

const REVIEWS: Review[] = RAW.map((raw) => reviewSchema.parse(raw));

export async function listReviews(productHandle: string): Promise<Review[]> {
  return sortByNewest(
    REVIEWS.filter((review) => review.productHandle === productHandle),
  );
}
