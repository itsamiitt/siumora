import Link from "next/link";

import { Display, MicroLabel } from "@siumora/ui";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-5 py-32 text-center">
      <Display as="h1" size="md">
        Nothing kept here.
      </Display>
      <p className="mt-4 text-content-muted">
        The page you were looking for has moved or never existed.
      </p>
      <Link
        href="/"
        className="mt-8 border-b border-content pb-1 transition-colors hover:border-accent-ink hover:text-accent-ink"
      >
        <MicroLabel>Back to shop</MicroLabel>
      </Link>
    </div>
  );
}
