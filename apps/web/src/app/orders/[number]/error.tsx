"use client";

import { ErrorState } from "@/components/error-state";

/**
 * The page failed, not the order. A shopper who just paid lands here first,
 * so the copy says what is true — the order is stored server-side whether or
 * not this page can show it — without claiming a state it cannot see.
 */
export default function OrderError({
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
      title="We could not show your order."
      detail="This page could not load just now, but your order is safe — if you paid, the payment is recorded against it. Please try again in a moment."
    >
      <p className="mt-3 text-sm text-content-muted">
        Still stuck? Write to us with your order number and we will confirm it
        for you.
      </p>
    </ErrorState>
  );
}
