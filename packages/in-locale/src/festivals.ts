/**
 * Festival calendar.
 *
 * Indian retail runs on a handful of dates and the shape of a year is not
 * negotiable: Diwali is the quarter, Rakhi and Karwa Chauth are gifting spikes,
 * Akshaya Tritiya is the day people buy gold on purpose. A storefront that
 * looks identical through all of them reads as a foreign catalogue.
 *
 * Dates are listed rather than computed. The Hindu calendar is lunisolar, so
 * the Gregorian date moves every year and no rule short of a full panchang
 * implementation gets it right — a wrong Diwali is worse than a listed one, and
 * a listed one is a two-minute edit each year.
 *
 * These are the observance dates; the retail window opens earlier because that
 * is when people shop, not when they celebrate.
 */

export interface Festival {
  readonly key: string;
  readonly name: string;
  /** Inclusive ISO dates for the retail window, not the observance itself. */
  readonly from: string;
  readonly to: string;
  /** The line the storefront shows. Never invents urgency that is not real. */
  readonly line: string;
}

export const FESTIVALS: readonly Festival[] = [
  {
    key: "akshaya-tritiya-2026",
    name: "Akshaya Tritiya",
    from: "2026-04-13",
    to: "2026-04-20",
    line: "Akshaya Tritiya — the day for something kept.",
  },
  {
    key: "raksha-bandhan-2026",
    name: "Raksha Bandhan",
    from: "2026-08-19",
    to: "2026-08-28",
    line: "Raksha Bandhan — wrapped and sent, in time.",
  },
  {
    key: "navratri-2026",
    name: "Navratri",
    from: "2026-10-04",
    to: "2026-10-20",
    line: "Nine nights. Nine reasons to wear it.",
  },
  {
    key: "karwa-chauth-2026",
    name: "Karwa Chauth",
    from: "2026-10-24",
    to: "2026-10-29",
    line: "Karwa Chauth — delivered before the moon.",
  },
  {
    key: "diwali-2026",
    name: "Diwali",
    from: "2026-10-30",
    to: "2026-11-09",
    line: "Diwali — something given, something kept.",
  },
];

/**
 * The festival window today falls inside, if any.
 *
 * Compared as plain ISO date strings in IST. Comparing `Date` objects would
 * make the banner appear five and a half hours early for a server in UTC —
 * which is exactly the kind of off-by-a-timezone that ships a Diwali banner on
 * the wrong evening.
 */
export function activeFestival(
  now: Date = new Date(),
  calendar: readonly Festival[] = FESTIVALS,
): Festival | undefined {
  const today = istDate(now);
  return calendar.find(
    (festival) => today >= festival.from && today <= festival.to,
  );
}

/** Today's date in IST, as YYYY-MM-DD. */
export function istDate(now: Date = new Date()): string {
  // en-CA formats as ISO, which is the one thing it is reliably good for.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Days left in the window, inclusive of today. Drives "ends in 3 days". */
export function daysRemaining(festival: Festival, now: Date = new Date()): number {
  const today = new Date(`${istDate(now)}T00:00:00Z`).getTime();
  const end = new Date(`${festival.to}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((end - today) / 86_400_000) + 1);
}
