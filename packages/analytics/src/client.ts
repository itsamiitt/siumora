import {
  DEFAULT_CONSENT,
  adsAllowed,
  analyticsAllowed,
  type ConsentState,
} from "./consent.ts";
import type { EventName, EventPayload } from "./events.ts";
import {
  META_EVENT_MAP,
  SERVER_ONLY_EVENTS,
  toMetaContents,
} from "./routing.ts";

/**
 * Payload validation, in development only.
 *
 * The schemas are a guard against a mistake at the call site, and TypeScript
 * already refuses the same mistake at compile time. Shipping Zod to every
 * visitor to re-check it costs roughly 20 kB gzip — against a 150 kB budget —
 * to catch nothing a developer has not already seen.
 *
 * A dynamic import inside this guard is dropped entirely from a production
 * bundle; a static one would pull Zod in whatever the branch said at runtime.
 */
let schemas: typeof import("./events.ts").EVENT_SCHEMAS | undefined;
if (process.env.NODE_ENV !== "production") {
  // Awaited, not fired-and-forgotten: the first `track()` can run in the same
  // tick this module is imported, and a promise that had not settled yet would
  // wave the very payload the guard exists to catch straight through.
  ({ EVENT_SCHEMAS: schemas } = await import("./events.ts"));
}

/**
 * Browser-side `track()`.
 *
 * Pushes to the GTM dataLayer, mirrors to the Meta Pixel where a standard event
 * exists, and captures to PostHog. Every destination is best-effort: analytics
 * must never break a purchase, so a missing or blocked vendor script is a
 * no-op, not a thrown error.
 */

interface DataLayerObject {
  event: string;
  [key: string]: unknown;
}

declare global {
  interface Window {
    dataLayer?: DataLayerObject[];
    fbq?: (...args: unknown[]) => void;
    posthog?: { capture: (event: string, props?: unknown) => void };
  }
}

let consent: ConsentState = DEFAULT_CONSENT;

/**
 * Whether the visitor has actually answered the banner.
 *
 * "Undecided" is not the same as "denied". Events that happen before the
 * answer are held rather than dropped: a visitor lands on a product page, the
 * `view_item` fires on mount, and only then do they accept. Discarding it would
 * make the first page view of every new visitor invisible and understate the
 * top of every funnel.
 */
let decided = false;

/** Events awaiting a consent decision. Bounded so a bot cannot grow it freely. */
const pending: Array<{ name: EventName; payload: unknown; options: TrackOptions }> =
  [];
const PENDING_LIMIT = 50;

export function setConsent(next: ConsentState, options: { decided?: boolean } = {}): void {
  consent = next;

  // A pre-decision default is not an answer, so the queue keeps waiting.
  if (options.decided === false) return;
  decided = true;

  const queued = pending.splice(0, pending.length);
  // Replay only if the visitor said yes; on refusal the queue is simply dropped.
  if (analyticsAllowed(consent) || adsAllowed(consent)) {
    for (const item of queued) {
      dispatch(item.name, item.payload as never, item.options);
    }
  }
}

export function getConsent(): ConsentState {
  return consent;
}

export interface TrackOptions {
  /** Skip the Meta Pixel send when the server is the only sender. */
  skipMeta?: boolean;
}

export function track<N extends EventName>(
  name: N,
  payload: EventPayload<N>,
  options: TrackOptions = {},
): void {
  if (typeof window === "undefined") return;

  if (SERVER_ONLY_EVENTS.has(name)) {
    // A browser-sent refund would be trivially forgeable and would corrupt
    // reported revenue.
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[analytics] "${name}" is server-only; ignoring browser send.`);
    }
    return;
  }

  // In development a malformed payload fails loudly here rather than landing
  // as an unusable row in GA4. In production the compiler is the contract.
  if (process.env.NODE_ENV !== "production" && schemas) {
    const parsed = schemas[name].safeParse(payload);
    if (!parsed.success) {
      console.error(`[analytics] invalid "${name}" payload`, parsed.error.issues);
      return;
    }
  }
  const data = payload as EventPayload<N>;

  // Hold until the banner is answered, then replay or drop.
  if (!decided) {
    if (pending.length < PENDING_LIMIT) {
      pending.push({ name, payload: data, options });
    }
    return;
  }

  dispatch(name, data, options);
}

function dispatch<N extends EventName>(
  name: N,
  data: EventPayload<N>,
  options: TrackOptions,
): void {
  if (analyticsAllowed(consent)) {
    window.dataLayer ??= [];
    window.dataLayer.push({ event: name, ...data });
    window.posthog?.capture(name, data);
  }

  const metaEvent = META_EVENT_MAP[name];
  if (metaEvent && !options.skipMeta && adsAllowed(consent) && window.fbq) {
    const withItems = data as { items?: Parameters<typeof toMetaContents>[0] };
    const value = (data as { value?: number }).value;

    window.fbq(
      "track",
      metaEvent,
      {
        currency: "INR",
        ...(value !== undefined ? { value } : {}),
        ...(withItems.items
          ? {
              contents: toMetaContents(withItems.items),
              content_type: "product",
            }
          : {}),
      },
      // The shared id Meta dedupes the server event against.
      { eventID: data.event_id },
    );
  }
}

/**
 * Re-exported for the browser.
 *
 * These live in zod-free modules. Reaching them through the package barrel
 * instead would pull `events.ts` — and Zod with it — into every client chunk
 * that mints an event id.
 */
export { mintEventId } from "./identity.ts";
export { toRupees } from "./routing.ts";
export type { AnalyticsItem, EventName, EventPayload } from "./events.ts";
export {
  DEFAULT_CONSENT,
  FULL_CONSENT,
  consentFromChoice,
  type ConsentChoice,
  type ConsentState,
} from "./consent.ts";

/**
 * The visitor's GA4 client id, out of the _ga cookie.
 *
 * The Measurement Protocol will not accept a server event without one, and the
 * browser is the only place it exists — so it has to be read here and carried
 * to the server at checkout, or the server half of the dual-send can never
 * fire and the conversions that blockers ate stay unreported.
 *
 * The cookie is `GA1.1.<client_id>` where the id is two dot-separated numbers.
 * Returns undefined when analytics is blocked, which is a real state and not
 * one to substitute a value for.
 */
export function gaClientId(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(/(?:^|;\s*)_ga=GA\d\.\d\.([\d.]+)/);
  return match?.[1];
}
