import { cacheLife } from "next/cache";
import Link from "next/link";

import { activeFestival, daysRemaining } from "@siumora/in-locale";
import { MicroLabel } from "@siumora/ui";

/**
 * Festival banner.
 *
 * Scheduled from the calendar in `packages/in-locale` rather than from a CMS,
 * because there is no CMS yet — plan/02 has this coming from Payload. The shape
 * is the same either way: a window, a line, a link. Swapping the source later
 * is a change to one function.
 *
 * Nothing renders outside a window. A permanent banner is a permanent 40px of
 * ignored chrome, and it teaches people to skip the one that matters.
 */
export async function FestivalBanner() {
  // Cached with an hourly life. The banner depends on today's date, and under
  // Cache Components a bare `new Date()` in a prerender would freeze whatever
  // day the build ran on — a Diwali banner that never comes down. An hour of
  // staleness around midnight IST is the right trade for a static shell.
  "use cache";
  cacheLife("hours");

  const festival = activeFestival();
  if (!festival) return null;

  const left = daysRemaining(festival);

  return (
    <div className="border-b border-brass/40 bg-plate text-ivory">
      <Link
        href="/collections/gifting"
        className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-5 py-2.5 text-center"
      >
        <MicroLabel className="text-ivory">{festival.line}</MicroLabel>
        {/* Only where it is true and near. A countdown that runs for three
            weeks is decoration; one that says "2 days" is information. */}
        {left <= 3 && (
          <span className="text-[11px] text-brass-light">
            {left === 1 ? "Last day" : `${left} days left`}
          </span>
        )}
      </Link>
    </div>
  );
}
