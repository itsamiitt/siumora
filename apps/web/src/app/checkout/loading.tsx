import { Skeleton } from "@siumora/ui";

/**
 * Checkout's placeholder — the three steps and the summary card in the
 * same boxes the page will fill, so nothing jumps when it lands (it used to
 * be a blank screen while the store config, bag and addresses loaded).
 * `bare` is the in-page Suspense fallback, under the page's own heading.
 */
export default function Loading({ bare = false }: { bare?: boolean }) {
  const body = (
    <div className="grid gap-10 lg:grid-cols-[1fr_24rem] lg:gap-16">
      <div className="space-y-8">
        {[0, 1, 2].map((step) => (
          <div key={step} className="border-b border-[var(--color-rule)] pb-6">
            <Skeleton className="h-4 w-32" />
            {step === 0 && <Skeleton className="mt-5 h-12 w-full" />}
          </div>
        ))}
        <Skeleton className="h-14 w-full" />
      </div>
      <Skeleton className="hidden h-80 w-full lg:block" />
    </div>
  );
  if (bare) return body;
  return (
    <div className="mx-auto max-w-6xl px-5 pb-16 pt-8 lg:pt-12">
      <Skeleton className="mb-10 h-9 w-40" />
      {body}
    </div>
  );
}
