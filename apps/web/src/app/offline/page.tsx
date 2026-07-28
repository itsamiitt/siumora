import type { Metadata } from "next";

import { Display, MicroLabel, SiumoraMark } from "@siumora/ui";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false, follow: false },
};

/**
 * Served by the service worker when the network is gone.
 *
 * Says what happened and nothing else. Offering a retry button that cannot work
 * without a connection, or a cached catalogue with prices from yesterday, is
 * worse than an honest dead end.
 */
export default function OfflinePage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-5 py-32 text-center">
      <SiumoraMark size={44} />
      <Display as="h1" size="sm" className="mt-8">
        No connection.
      </Display>
      <p className="mt-4 text-content-muted">
        Siumora needs the network to show you what is in stock and what it
        costs. This page will work again the moment you are back.
      </p>
      <p className="mt-8">
        <MicroLabel>Nothing in your bag has been lost.</MicroLabel>
      </p>
    </div>
  );
}
