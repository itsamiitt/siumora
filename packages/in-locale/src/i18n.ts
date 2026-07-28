/**
 * Locale scaffolding.
 *
 * `en-IN` launches; `hi-IN` follows once there is translated content worth
 * shipping. The scaffolding lands now because retrofitting it is the expensive
 * part — every hard-coded string has to be found again — while adding a second
 * dictionary to an existing structure is a file.
 *
 * Deliberately not `next-intl` yet. A routing library brings a URL scheme,
 * middleware and a negotiation strategy, and picking those before there is a
 * single translated sentence is choosing under no information. This is the part
 * that has to exist either way: the locale list, the dictionary shape, and the
 * `hreflang` set that tells search engines what exists.
 */

export const LOCALES = ["en-IN", "hi-IN"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en-IN";

/**
 * Locales with enough translated content to serve.
 *
 * `hi-IN` is declared but not live. Announcing an `hreflang` for a page that
 * would serve English is a worse signal than announcing nothing — search
 * engines treat it as a broken alternate, and a Hindi-speaking visitor lands on
 * exactly the page they were trying to leave.
 */
export const LIVE_LOCALES: readonly Locale[] = ["en-IN"];

export function isLive(locale: Locale): boolean {
  return LIVE_LOCALES.includes(locale);
}

/**
 * The strings the interface itself owns.
 *
 * Product copy, policies and guides are content and belong in the CMS; this is
 * only the chrome. Keeping the two apart means a translator is handed sentences
 * rather than a codebase.
 */
export interface Dictionary {
  readonly nav: {
    readonly search: string;
    readonly saved: string;
    readonly account: string;
    readonly bag: string;
    readonly deliverTo: string;
  };
  readonly product: {
    readonly addToBag: string;
    readonly soldOut: string;
    readonly adding: string;
    readonly options: string;
    readonly saveForLater: string;
    readonly inclusiveOfTax: string;
    readonly holdToZoom: string;
  };
  readonly cart: {
    readonly empty: string;
    readonly checkout: string;
    readonly subtotal: string;
  };
}

const EN_IN: Dictionary = {
  nav: {
    search: "Search",
    saved: "Saved",
    account: "Account",
    bag: "Bag",
    deliverTo: "Deliver to",
  },
  product: {
    addToBag: "Add to bag",
    soldOut: "Sold out",
    adding: "Adding…",
    options: "Options",
    saveForLater: "Save for later",
    inclusiveOfTax: "Inclusive of all taxes",
    holdToZoom: "Hold the image to zoom",
  },
  cart: {
    empty: "Your bag is empty.",
    checkout: "Checkout",
    subtotal: "Subtotal",
  },
};

const DICTIONARIES: Record<Locale, Dictionary> = {
  "en-IN": EN_IN,
  // Not translated yet, and pointing at English rather than at a half-filled
  // Hindi dictionary: a page mixing the two reads as broken, where a page
  // consistently in English reads as not-yet-translated.
  "hi-IN": EN_IN,
};

export function dictionary(locale: Locale = DEFAULT_LOCALE): Dictionary {
  return DICTIONARIES[locale] ?? EN_IN;
}

/**
 * The `hreflang` alternates for a path.
 *
 * Only live locales are listed, plus `x-default` pointing at the launch locale.
 */
export function alternates(
  path: string,
  origin: string,
): Record<string, string> {
  const clean = path.startsWith("/") ? path : `/${path}`;
  const entries: Record<string, string> = { "x-default": `${origin}${clean}` };

  for (const locale of LOCALES) {
    if (!isLive(locale)) continue;
    // The launch locale serves from the bare path; a future `hi-IN` will get a
    // prefix, which is why this is a function rather than a constant map.
    entries[locale] =
      locale === DEFAULT_LOCALE
        ? `${origin}${clean}`
        : `${origin}/${locale.split("-")[0]}${clean}`;
  }

  return entries;
}
