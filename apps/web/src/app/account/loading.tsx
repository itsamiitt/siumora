import { Skeleton } from "@siumora/ui";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="mt-3 h-3 w-64" />
      <div className="mt-10 space-y-px border-y border-[var(--color-rule)]">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    </div>
  );
}
