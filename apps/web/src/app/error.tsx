"use client";

import { ErrorState } from "@/components/error-state";

/**
 * The site-wide boundary. Without it a backend outage on the home page, the
 * shop or search renders Next's bare "Application error" — this keeps the
 * header, the footer and a way back.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState error={error} reset={reset} />;
}
