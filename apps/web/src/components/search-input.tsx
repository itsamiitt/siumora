"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { track, mintEventId } from "@siumora/analytics/client";
import { Button } from "@siumora/ui";

import { VoiceSearch } from "./voice-search";

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

  function run(raw: string) {
    const query = raw.trim();
    if (!query) return;

    track("search", { event_id: mintEventId(), search_term: query });
    router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    run(value);
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
        className="h-11 min-w-0 flex-1 border border-content/20 bg-transparent px-3 text-sm outline-none focus:border-accent-ink"
      />
      {/* Speaking a query runs it straight away. Filling the box and waiting
          for a second tap loses the speed that made voice worth offering. */}
      <VoiceSearch
        onResult={(transcript) => {
          setValue(transcript);
          run(transcript);
        }}
      />
      <Button type="submit" size="sm">
        Search
      </Button>
    </form>
  );
}
