"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import { Button, Display, MicroLabel } from "@siumora/ui";

/**
 * The body every route error boundary renders: what happened in plain words,
 * a way to try again, and a way out.
 *
 * "Try again" refreshes the server render as well as resetting the boundary:
 * these errors almost always come from the commerce backend being briefly
 * unreachable, and reset() alone would re-render the same failed payload.
 */
export function ErrorState({
  error,
  reset,
  title = "Something slipped.",
  detail = "This page could not load just now. It is usually a moment's hiccup — please try again.",
  children,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  useEffect(() => {
    // The digest is what ties this screen to the server log line.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-5 py-24 text-center sm:py-32">
      <Display as="h1" size="md">
        {title}
      </Display>
      <p className="mt-4 text-content-muted">{detail}</p>
      {children}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-6">
        <Button
          disabled={pending}
          onClick={() =>
            start(() => {
              router.refresh();
              reset();
            })
          }
        >
          {pending ? "Trying…" : "Try again"}
        </Button>
        <Link
          href="/"
          className="border-b border-content pb-1 transition-colors hover:border-accent-ink hover:text-accent-ink"
        >
          <MicroLabel>Back to shop</MicroLabel>
        </Link>
      </div>
      {error.digest && (
        <p className="mt-10 text-xs text-content-faint">Reference {error.digest}</p>
      )}
    </div>
  );
}
