import { summariseRatings, type Review } from "@siumora/core";
import { CollectionTitle, MicroLabel, Stars } from "@siumora/ui";

/**
 * Reviews on the product page.
 *
 * Shows the distribution as well as the average, because a 4.3 built from
 * fives and a two reads very differently from a 4.3 where everyone said four —
 * and hiding that is the kind of thing shoppers notice.
 */
export function ReviewsBlock({ reviews }: { reviews: readonly Review[] }) {
  const summary = summariseRatings(reviews);

  if (summary.average === null) {
    return (
      <section className="mt-16 border-t border-[var(--color-rule)] pt-10">
        <CollectionTitle className="text-xs">Reviews</CollectionTitle>
        <p className="mt-4 text-sm text-ink-muted">
          No reviews yet. Yours would be the first.
        </p>
      </section>
    );
  }

  const verified = reviews.filter((review) => review.verifiedBuyer);

  return (
    <section className="mt-16 border-t border-[var(--color-rule)] pt-10">
      <CollectionTitle className="text-xs">Reviews</CollectionTitle>

      <div className="mt-5 flex flex-wrap items-center gap-8">
        <div>
          <p className="font-display text-4xl font-light">
            {summary.average.toFixed(1)}
          </p>
          <Stars rating={summary.average} className="mt-1.5" />
          <p className="mt-1.5 text-xs text-ink-muted">
            {summary.count} verified {summary.count === 1 ? "buyer" : "buyers"}
          </p>
        </div>

        <dl className="min-w-48 flex-1 space-y-1">
          {([5, 4, 3, 2, 1] as const).map((star) => {
            const value = summary.distribution[star];
            const width = summary.count > 0 ? (value / summary.count) * 100 : 0;

            return (
              <div key={star} className="flex items-center gap-3 text-xs">
                <dt className="w-3 text-ink-muted">{star}</dt>
                <dd className="flex-1">
                  <div className="h-px w-full bg-ink/12">
                    <div
                      className="h-px bg-mulberry"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </dd>
                <span className="w-4 text-right tabular-nums text-ink-faint">
                  {value}
                </span>
              </div>
            );
          })}
        </dl>
      </div>

      <ul className="mt-10 space-y-8">
        {verified.map((review) => (
          <li key={review.id}>
            <div className="flex flex-wrap items-center gap-3">
              <Stars rating={review.rating} />
              <MicroLabel>Verified buyer</MicroLabel>
            </div>
            <h3 className="mt-2.5 font-heading text-sm uppercase" style={{ letterSpacing: "var(--tracking-caps)" }}>
              {review.title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
              {review.body}
            </p>
            <p className="mt-2 text-xs text-ink-faint">
              {review.authorName} ·{" "}
              {new Date(review.createdAt).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
