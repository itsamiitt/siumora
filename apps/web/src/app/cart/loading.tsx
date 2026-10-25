import { Skeleton } from "@siumora/ui";

/**
 * The bag's placeholder, in the page's own grid (max-w-6xl, a 22rem
 * summary) — it used to be narrower than the page it stood in for, so the
 * layout jumped when the bag landed.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-32 pt-14 lg:pb-14">
      <Skeleton className="h-9 w-40" />
      <div className="mt-10 grid gap-14 lg:grid-cols-[1fr_22rem]">
        <div>
          <Skeleton className="h-3.5 w-2/3" />
          <div className="mt-8 space-y-6">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="flex gap-5">
                <Skeleton className="aspect-4/5 w-24 shrink-0" />
                <div className="flex-1">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="mt-2.5 h-3 w-1/4" />
                  <Skeleton className="mt-6 h-11 w-32" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <Skeleton className="h-72 w-full" />
          <Skeleton className="mt-6 h-14 w-full" />
        </div>
      </div>
    </div>
  );
}
