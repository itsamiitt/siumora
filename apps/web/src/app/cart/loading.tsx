import { Skeleton } from "@siumora/ui";

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-14">
      <Skeleton className="h-9 w-40" />
      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex gap-5">
              <Skeleton className="aspect-4/5 w-24 shrink-0" />
              <div className="flex-1">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="mt-2.5 h-3 w-1/4" />
                <Skeleton className="mt-6 h-8 w-28" />
              </div>
            </div>
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
