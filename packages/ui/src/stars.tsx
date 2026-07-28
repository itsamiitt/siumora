import { cn } from "./cn.ts";

/**
 * Star rating.
 *
 * Drawn with the brand's own geometry rather than a generic star glyph: the
 * filled mark is the Petal & Kernel shape, so a rating row reads as part of the
 * identity instead of borrowed furniture. Mulberry is the accent, used here
 * because a rating is one of the few places a view earns a second accent moment.
 */
export function Stars({
  rating,
  count,
  size = 14,
  className,
}: {
  /** 1–5, may be fractional. */
  rating: number;
  /** Shown alongside when provided. */
  count?: number;
  size?: number;
  className?: string;
}) {
  const rounded = Math.round(rating);

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        className="inline-flex items-center gap-0.5"
        role="img"
        aria-label={`${rating} out of 5`}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <svg
            key={star}
            viewBox="0 0 100 100"
            width={size}
            height={size}
            aria-hidden="true"
          >
            <g
              fill="none"
              stroke={star <= rounded ? "#6B2942" : "rgb(28 25 23 / 0.22)"}
              strokeWidth="6"
            >
              <circle cx="50" cy="28" r="22" />
              <circle cx="72" cy="50" r="22" />
              <circle cx="50" cy="72" r="22" />
              <circle cx="28" cy="50" r="22" />
            </g>
            {star <= rounded && <circle cx="50" cy="50" r="12" fill="#6B2942" />}
          </svg>
        ))}
      </span>

      {count !== undefined && (
        <span className="font-body text-xs text-content-muted">
          {rating.toFixed(1)} ({count})
        </span>
      )}
    </span>
  );
}
