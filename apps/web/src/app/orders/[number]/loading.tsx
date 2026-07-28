import { Skeleton, TextSkeleton } from "@siumora/ui";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <Skeleton className="mx-auto size-11 rounded-full" />
      <Skeleton className="mx-auto mt-6 h-9 w-72" />
      <Skeleton className="mx-auto mt-3 h-3 w-40" />
      <Skeleton className="mt-12 h-2 w-full" />
      <div className="mt-12">
        <TextSkeleton lines={5} />
      </div>
    </div>
  );
}
