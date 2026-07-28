import { Skeleton, TextSkeleton } from "@siumora/ui";

/**
 * PDP placeholder.
 *
 * Boxed to the same grid and the same 4:5 plate as the real page, so nothing
 * shifts when the product arrives — a skeleton that reserves the wrong space
 * spends the CLS budget it exists to protect.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <div className="grid gap-12 lg:grid-cols-2">
        <div>
          <Skeleton className="aspect-4/5 w-full" />
          <div className="mt-3 flex gap-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="aspect-4/5 w-16" />
            ))}
          </div>
        </div>

        <div className="lg:py-6">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-4 h-9 w-2/3" />
          <Skeleton className="mt-3 h-3.5 w-1/2" />
          <Skeleton className="mt-7 h-7 w-32" />
          <Skeleton className="mt-9 h-11 w-40" />
          <Skeleton className="mt-6 h-14 w-full" />
          <div className="mt-10 border-t border-[var(--color-rule)] pt-8">
            <TextSkeleton lines={4} />
          </div>
        </div>
      </div>
    </div>
  );
}
