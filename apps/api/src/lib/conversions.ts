import type { FastifyInstance } from "fastify";

import { DEFAULT_CONSENT, FULL_CONSENT, type ConsentState } from "@siumora/analytics";
import { emit } from "@siumora/analytics/server";
import { toRupees, type EventName, type EventPayload } from "@siumora/analytics";
import { recordTrackingEvent, schema, type Database } from "@siumora/db";

/**
 * Server-side conversions.
 *
 * Browser-only tracking loses a large share of Indian conversions to blockers
 * and privacy defaults, so the important events are also sent from here. Both
 * sends carry the `event_id` minted at checkout, which is what makes them
 * collapse into one conversion instead of two.
 *
 * Everything is written to the ledger before anything is sent. That ordering is
 * the point: a send that fails can be replayed with the same id, and a
 * conversion that never went can be found. Sending first and recording after
 * would lose exactly the events worth knowing about.
 */

/**
 * When a purchase counts, which is not the same question for COD.
 *
 * A prepaid order is money in hand at confirmation. A COD order is a promise
 * until the parcel is handed over — and roughly a fifth of them come back. A
 * `purchase` fired at COD checkout inflates reported revenue, and worse, it
 * teaches the ad platforms to buy more of the traffic that returns most.
 *
 * So prepaid converts at confirmation and COD converts at delivery, under the
 * `cod_delivered` name doc 08 §6 reserves for it.
 */
export function conversionEventFor(
  paymentMethod: string,
  status: string,
): EventName | undefined {
  if (paymentMethod === "cod") {
    return status === "delivered" ? "cod_delivered" : undefined;
  }
  return status === "confirmed" ? "purchase" : undefined;
}

type OrderRow = typeof schema.orders.$inferSelect;
type LineRow = typeof schema.orderLines.$inferSelect;

/** The GA4 items array for an order, from what was actually invoiced. */
function itemsFor(lines: readonly LineRow[]) {
  return lines.map((line) => ({
    item_id: line.sku,
    item_name: line.title,
    price: toRupees(line.unitPrice),
    quantity: line.quantity,
    item_variant: line.variantTitle,
    item_brand: "Siumora",
  }));
}

/**
 * The consent this order was placed under.
 *
 * Defaults to denied when nothing was recorded. A missing consent row is not
 * permission — under DPDP it is the absence of it — so the event still goes but
 * carries no identifiers, which is a modelled conversion rather than none.
 */
async function consentFor(
  db: Database,
  subjectId: string,
): Promise<ConsentState> {
  const { eq, desc } = await import("@siumora/db");
  const [row] = await db
    .select()
    .from(schema.consentLog)
    .where(eq(schema.consentLog.subjectId, subjectId))
    .orderBy(desc(schema.consentLog.recordedAt))
    .limit(1);

  if (!row) return DEFAULT_CONSENT;
  return row.ads && row.analytics ? FULL_CONSENT : DEFAULT_CONSENT;
}

/**
 * Queue the conversion for an order, if this transition is the one that counts.
 *
 * Idempotent through the ledger's unique index, so a replayed webhook or a
 * retried status change cannot double-count. Never throws into the caller: a
 * tracking failure must not roll back an order that genuinely happened.
 */
export async function queueOrderConversion(
  server: FastifyInstance,
  order: OrderRow,
  lines: readonly LineRow[],
): Promise<{ queued: boolean; event?: EventName }> {
  const event = conversionEventFor(order.paymentMethod, order.status);
  if (!event) return { queued: false };

  try {
    const address = order.address as { phone?: string; pincode?: string };
    const consent = await consentFor(server.db, order.eventId);

    const payload = {
      event_id: order.eventId,
      currency: "INR",
      value: toRupees(order.total),
      transaction_id: order.number,
      tax: toRupees(order.cgst + order.sgst + order.igst),
      shipping: toRupees(order.shipping),
      items: itemsFor(lines),
    } as EventPayload<typeof event>;

    const built = await emit(event, payload, {
      consent,
      identity: {
        ...(address.phone ? { phone: address.phone } : {}),
        // GA4's Measurement Protocol refuses an event without one, and only
        // the browser has it. Captured at checkout; absent when analytics was
        // blocked, which is a fact the ledger records rather than papers over.
        ...(order.gaClientId ? { gaClientId: order.gaClientId } : {}),
      },
      // Meta dedupes within 48 hours of the event time, so this has to be when
      // the conversion happened, not when the worker got round to it.
      eventTime: Math.floor(
        (order.status === "delivered" && order.deliveredAt
          ? order.deliveredAt
          : order.placedAt
        ).getTime() / 1000,
      ),
    });

    // A row goes in either way. Recording nothing when GA4 cannot be reached
    // would leave the parity report unable to tell "not configured" from
    // "we never had a client id" from "nobody looked".
    await recordTrackingEvent(server.db, {
      eventId: order.eventId,
      eventName: event,
      destination: "ga4",
      payload: built.ga4 ?? { unsendable: "no ga client id captured" },
      orderId: order.id,
      status: !built.ga4 || !server.config.ga4Configured ? "skipped" : "pending",
    });

    if (built.meta) {
      await recordTrackingEvent(server.db, {
        eventId: order.eventId,
        eventName: event,
        destination: "meta",
        payload: built.meta,
        orderId: order.id,
        status: server.config.metaConfigured ? "pending" : "skipped",
      });
    }

    return { queued: true, event };
  } catch (error) {
    // An order that happened must not be rolled back because a pixel payload
    // could not be built. Logged loudly; the parity report will find the gap.
    server.log?.error?.({ err: error, order: order.number }, "conversion not queued");
    return { queued: false };
  }
}
