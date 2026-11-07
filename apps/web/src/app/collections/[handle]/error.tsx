"use client";

import { ErrorState } from "@/components/error-state";

export default function CollectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      title="This edit is taking a moment."
      detail="We could not load this collection just now. Please try again shortly."
    />
  );
}
