import { Skeleton } from "@siumora/ui";

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-14">
      <Skeleton className="h-9 w-24" />
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="mt-10 h-64 w-full" />
    </div>
  );
}
