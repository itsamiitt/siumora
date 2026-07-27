import { userDataAllowed, type ConsentState } from "./consent.ts";
import {
  EVENT_SCHEMAS,
  META_EVENT_MAP,
  toMetaContents,
  type EventName,
  type EventPayload,
} from "./events.ts";
import { hashIdentity, type RawIdentity } from "./identity.ts";

/**
 * Server-side `emit()` — GA4 Measurement Protocol and the Meta Conversions API.
 *
 * The server send exists because browser-only tracking loses a large share of
 * conversions to blockers and privacy restrictions. It carries the same
 * `event_id` as the browser send so the two collapse into one conversion
 * rather than double-counting.
 */

export interface EmitContext {
  consent: ConsentState;
  identity?: RawIdentity;
  /** The page the action happened on. Required by Meta for web events. */
  sourceUrl?: string;
  /** Unix seconds. Meta dedupes within 48 hours, so this must not lag. */
  eventTime?: number;
}

export interface MetaCapiPayload {
  event_name: string;
  event_id: string;
  event_time: number;
  action_source: "website";
  event_source_url?: string;
  user_data: Record<string, string>;
  custom_data: Record<string, unknown>;
}

export interface Ga4MeasurementPayload {
  client_id: string;
  events: Array<{ name: string; params: Record<string, unknown> }>;
  consent: {
    ad_user_data: "GRANTED" | "DENIED";
    ad_personalization: "GRANTED" | "DENIED";
  };
}

/**
 * Build the Meta CAPI payload.
 *
 * Returns null when there is no Meta counterpart for the event. Identifiers are
 * attached only with `ad_user_data` consent; without it the event still goes,
 * carrying no user data — a modelled conversion beats no conversion.
 */
export async function buildMetaPayload<N extends EventName>(
  name: N,
  payload: EventPayload<N>,
  context: EmitContext,
): Promise<MetaCapiPayload | null> {
  const metaEvent = META_EVENT_MAP[name];
  if (!metaEvent) return null;

  const data = EVENT_SCHEMAS[name].parse(payload) as EventPayload<N>;
  const identity =
    context.identity && userDataAllowed(context.consent)
      ? await hashIdentity(context.identity)
      : {};

  const items = (data as { items?: Parameters<typeof toMetaContents>[0] }).items;
  const value = (data as { value?: number }).value;

  return {
    event_name: metaEvent,
    event_id: data.event_id,
    event_time: context.eventTime ?? Math.floor(Date.now() / 1000),
    action_source: "website",
    ...(context.sourceUrl ? { event_source_url: context.sourceUrl } : {}),
    user_data: identity as Record<string, string>,
    custom_data: {
      currency: "INR",
      ...(value !== undefined ? { value } : {}),
      ...(items
        ? { contents: toMetaContents(items), content_type: "product" }
        : {}),
      ...((data as { transaction_id?: string }).transaction_id
        ? { order_id: (data as { transaction_id?: string }).transaction_id }
        : {}),
    },
  };
}

/**
 * Build the GA4 Measurement Protocol payload.
 *
 * Returns null without a GA4 client id: an MP hit with a synthesised id starts
 * a phantom session and detaches the purchase from the browsing that led to it,
 * which is worse for attribution than sending nothing.
 */
export function buildGa4Payload<N extends EventName>(
  name: N,
  payload: EventPayload<N>,
  context: EmitContext,
): Ga4MeasurementPayload | null {
  const clientId = context.identity?.gaClientId;
  if (!clientId) return null;

  const data = EVENT_SCHEMAS[name].parse(payload) as EventPayload<N>;
  const { event_id, ...params } = data as Record<string, unknown> & {
    event_id: string;
  };

  return {
    client_id: clientId,
    events: [{ name, params: { ...params, event_id } }],
    consent: {
      ad_user_data: userDataAllowed(context.consent) ? "GRANTED" : "DENIED",
      ad_personalization:
        context.consent.ad_personalization === "granted" ? "GRANTED" : "DENIED",
    },
  };
}

export interface EmitResult {
  meta: MetaCapiPayload | null;
  ga4: Ga4MeasurementPayload | null;
}

/**
 * Prepare both server payloads for an event.
 *
 * Transport is deliberately not here: the sends belong on the worker's retry
 * queue (a failed CAPI post must be retried with the *same* event_id, not
 * dropped), and building the payloads separately keeps them unit-testable
 * without stubbing the network.
 */
export async function emit<N extends EventName>(
  name: N,
  payload: EventPayload<N>,
  context: EmitContext,
): Promise<EmitResult> {
  return {
    meta: await buildMetaPayload(name, payload, context),
    ga4: buildGa4Payload(name, payload, context),
  };
}
