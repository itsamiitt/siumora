import { ProductCardSkeleton, Skeleton } from "@siumora/ui";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="mt-6 h-12 w-full max-w-xl" />
      <div className="mt-12 grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
