"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { mintEventId } from "@siumora/analytics";
import { track } from "@siumora/analytics/client";
import { Button } from "@siumora/ui";

/**
 * Search box.
 *
 * Submits rather than searching per keystroke: the query lands in the URL, so a
 * result page can be shared, bookmarked and measured. The `search` event fires
 * on submit for the same reason — per-keystroke events would report "gol",
 * "gold" and "gold r" as three separate searches.
 */
export function SearchInput({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const query = value.trim();
    if (!query) return;

    track("search", { event_id: mintEventId(), search_term: query });
    router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  return (
    <form onSubmit={submit} className="flex gap-2" role="search">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        type="search"
        name="q"
        aria-label="Search"
        placeholder="Try “jhumka” or “gift under 2000”"
        className="h-11 min-w-0 flex-1 border border-ink/20 bg-transparent px-3 text-sm outline-none focus:border-mulberry"
      />
      <Button type="submit" size="sm">
        Search
      </Button>
    </form>
  );
}
