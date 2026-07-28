import { ProductCardSkeleton, Skeleton } from "@siumora/ui";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-4 h-9 w-64" />
      <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4">
        {/* Four cards: the usual first row, so the fold is filled and the page
            does not grow underneath a reader who has already started. */}
        {Array.from({ length: 4 }, (_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
