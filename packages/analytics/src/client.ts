import {
  DEFAULT_CONSENT,
  adsAllowed,
  analyticsAllowed,
  type ConsentState,
} from "./consent.ts";
import {
  EVENT_SCHEMAS,
  META_EVENT_MAP,
  SERVER_ONLY_EVENTS,
  toMetaContents,
  type EventName,
  type EventPayload,
} from "./events.ts";

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

  // Validate before dispatch so a malformed payload fails here rather than
  // silently landing as an unusable row in GA4.
  const parsed = EVENT_SCHEMAS[name].safeParse(payload);
  if (!parsed.success) {
    if (process.env.NODE_ENV !== "production") {
      console.error(`[analytics] invalid "${name}" payload`, parsed.error.issues);
    }
    return;
  }
  const data = parsed.data as EventPayload<N>;

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
