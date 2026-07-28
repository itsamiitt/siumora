import type { TrackingDestination } from "@siumora/db";

/**
 * Where a conversion actually goes.
 *
 * Split from the drain so the queue's behaviour — claiming, retrying, giving
 * up — is testable without a network, and so the difference between "this will
 * work next time" and "this will never work" is decided in one place.
 */

export type SendOutcome =
  /** Accepted. */
  | { readonly kind: "sent" }
  /** Refused for a reason that may clear: a rate limit, a bad minute. */
  | { readonly kind: "retry"; readonly error: string }
  /**
   * Refused for a reason that will not clear. A malformed payload or a rejected
   * credential does not become valid by being sent four more times; retrying it
   * only delays the moment somebody notices.
   */
  | { readonly kind: "permanent"; readonly error: string };

export interface Transport {
  send(
    destination: TrackingDestination,
    payload: unknown,
  ): Promise<SendOutcome>;
}

export interface TransportConfig {
  /** GA4 Measurement Protocol. Both are needed or GA4 is not configured. */
  readonly ga4MeasurementId?: string;
  readonly ga4ApiSecret?: string;
  /** Meta Conversions API. */
  readonly metaPixelId?: string;
  readonly metaAccessToken?: string;
  /** Meta's graph version, pinned so a silent upgrade cannot change semantics. */
  readonly metaApiVersion?: string;
  /** Abandon a post after this long rather than holding a worker slot. */
  readonly timeoutMs?: number;
  /** Injected in tests; the global otherwise. */
  readonly fetch?: typeof globalThis.fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const META_API_VERSION = "v21.0";

/**
 * The real transport.
 *
 * A destination with no credentials returns `permanent` rather than throwing:
 * the row is meant to be marked and left alone, not retried five times against
 * an endpoint this environment was never given the keys to.
 */
export function httpTransport(config: TransportConfig): Transport {
  const doFetch = config.fetch ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async send(destination, payload) {
      const target = urlFor(destination, config);
      if (!target) {
        return {
          kind: "permanent",
          error: `${destination} is not configured in this environment`,
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await doFetch(target, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(bodyFor(destination, payload, config)),
          signal: controller.signal,
        });

        return classify(response.status, await safeText(response));
      } catch (error) {
        // A timeout or a DNS failure says nothing about the payload, so it is
        // always worth another go.
        return { kind: "retry", error: String(error) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * What an HTTP status means for a conversion.
 *
 * 429 is the one 4xx worth retrying — it is the destination asking for a pause,
 * not refusing the event. Everything else in the 4xx range is a statement about
 * the request, and the request will be byte-identical next time.
 */
export function classify(status: number, body: string): SendOutcome {
  if (status >= 200 && status < 300) {
    // GA4's Measurement Protocol answers 204 to almost anything, including
    // events it silently discards. Treated as sent because the alternative is
    // retrying a conversion the destination has already taken — which is worse.
    return { kind: "sent" };
  }
  if (status === 429 || status >= 500) {
    return { kind: "retry", error: `HTTP ${status}: ${body}` };
  }
  return { kind: "permanent", error: `HTTP ${status}: ${body}` };
}

function urlFor(
  destination: TrackingDestination,
  config: TransportConfig,
): string | undefined {
  if (destination === "ga4") {
    if (!config.ga4MeasurementId || !config.ga4ApiSecret) return undefined;
    return `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(
      config.ga4MeasurementId,
    )}&api_secret=${encodeURIComponent(config.ga4ApiSecret)}`;
  }

  if (!config.metaPixelId || !config.metaAccessToken) return undefined;
  const version = config.metaApiVersion ?? META_API_VERSION;
  return `https://graph.facebook.com/${version}/${encodeURIComponent(
    config.metaPixelId,
  )}/events?access_token=${encodeURIComponent(config.metaAccessToken)}`;
}

/**
 * The wire body.
 *
 * The ledger stores the payload the analytics package built, which is already
 * the GA4 shape. Meta wants its event wrapped in a `data` array, and that
 * wrapping is a transport concern rather than something to bake into the row —
 * a stored payload should stay the event, not the envelope.
 */
function bodyFor(
  destination: TrackingDestination,
  payload: unknown,
  _config: TransportConfig,
): unknown {
  return destination === "meta" ? { data: [payload] } : payload;
}

/** A body that cannot be read is not worth failing the classification over. */
async function safeText(response: { text(): Promise<string> }): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}

/** Whether anything is configured at all, for the startup log. */
export function configuredDestinations(
  config: TransportConfig,
): TrackingDestination[] {
  const destinations: TrackingDestination[] = [];
  if (config.ga4MeasurementId && config.ga4ApiSecret) destinations.push("ga4");
  if (config.metaPixelId && config.metaAccessToken) destinations.push("meta");
  return destinations;
}
