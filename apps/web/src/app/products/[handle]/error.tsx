"use client";

import { ErrorState } from "@/components/error-state";

export default function ProductError({
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
      title="This piece is hiding."
      detail="We could not load this piece just now. Your bag is safe — please try again in a moment."
    />
  );
}
