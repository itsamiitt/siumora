import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

// @ts-ignore -- TS1479: workspace ESM types with a CJS runtime
import { DEFAULT_CONSENT, FULL_CONSENT } from "@siumora/analytics";
// @ts-ignore -- TS1479: workspace ESM types with a CJS runtime
import { emit } from "@siumora/analytics/server";

import { conversionEventFor, messageFor, purchasePayload } from "../modules/outbox/compose";
import { enqueueNotification, recordTrackingEvent, type SqlClient } from "../modules/outbox/data";
import { getShipment, type SqlClient as StatusSqlClient } from "../modules/returns-ndr/data";
import { paymentMethodOf } from "../modules/siumora-order/checkout-rules";
import { toDomainOrder, type OrderWire } from "./domain-order-shape";

/**
 * The one place an order's new status reaches the customer and the ad
 * platforms (plan 16 Phase G) — the Medusa twin of the Fastify
 * setOrderStatus hub. Every path that moves an order calls this after the
 * move: placement (the order.placed subscriber), the operator's lever, the
 * courier webhook, the NDR answer. Calling it from each path is how a
 * webhook ends up silently not reporting revenue; calling this is how it
 * cannot.
 *
 * It writes to the outbox and returns — the worker sends. It never throws:
 * the order already moved, and a message or a pixel that could not be
 * queued must not undo that. A failure is logged loudly instead, and the
 * outbox health shows the gap.
 */

const ORDER_FIELDS = [
  "id",
  "status",
  "created_at",
  "customer_id",
  "metadata",
  "shipping_total",
  "shipping_methods.data",
  "shipping_address.*",
  "items.*",
  "items.variant.id",
  "items.variant.metadata",
  "items.variant.product.metadata",
  "items.adjustments.amount",
];

const configured = {
  ga4: () => Boolean(process.env.GA4_MEASUREMENT_ID && process.env.GA4_API_SECRET),
  meta: () => Boolean(process.env.META_PIXEL_ID && process.env.META_CAPI_TOKEN),
};

export async function orderMoved(container: MedusaContainer, orderId: string, status: string): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as { error(message: string): void };
  try {
    const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlClient;
    const query = container.resolve(ContainerRegistrationKeys.QUERY);

    const [{ data }, identity, shipment] = await Promise.all([
      query.graph({ entity: "order", fields: ORDER_FIELDS, filters: { id: orderId } }),
      pg.raw("SELECT order_number FROM siumora_order_identity WHERE order_id = ? AND deleted_at IS NULL", [orderId]),
      getShipment(pg as unknown as StatusSqlClient, orderId),
    ]);
    const wire = data[0] as (OrderWire & { customer_id?: string | null; metadata?: Record<string, unknown> | null }) | undefined;
    const number = (identity.rows[0] as { order_number?: string } | undefined)?.order_number;
    if (!wire || !number) return; // not a storefront order: nothing to say

    const statusRow = await pg.raw(
      "SELECT status, ndr_reason FROM siumora_order_status WHERE order_id = ? AND deleted_at IS NULL",
      [orderId],
    );
    const order = toDomainOrder(wire, {
      orderNumber: number,
      statusRow: { status, ndr_reason: (statusRow.rows[0] as { ndr_reason?: string | null } | undefined)?.ndr_reason ?? null },
      ndrAttempts: 0,
    });
    const metadata = wire.metadata ?? {};

    // ── The customer's message ──
    const intent = messageFor({
      id: orderId,
      number,
      status,
      name: order.address.name,
      phone: order.address.phone || undefined,
      totalPaise: order.totals.total,
      customerId: wire.customer_id ?? null,
      courier: shipment?.courier ?? null,
      awb: shipment?.awb ?? null,
      ndrReason: order.ndrReason ?? null,
    });
    if (intent) await enqueueNotification(pg, intent);

    // ── The conversion ──
    const method = paymentMethodOf(metadata);
    const event = conversionEventFor(method, status);
    if (!event) return;

    const eventId = typeof metadata.siumora_event_id === "string" ? metadata.siumora_event_id : orderId;
    const gaClientId = typeof metadata.siumora_ga_client_id === "string" ? metadata.siumora_ga_client_id : undefined;
    const payload = purchasePayload({
      eventId,
      orderNumber: number,
      totalPaise: order.totals.total,
      taxPaise: order.totals.gst.totalTax,
      shippingPaise: order.totals.shipping,
      lines: order.lines.map((line) => ({
        sku: line.sku,
        title: line.title,
        variantTitle: line.variantTitle,
        unitPricePaise: line.unitPrice,
        quantity: line.quantity,
      })),
    });
    const built = await emit(event, payload, {
      // Only the shopper's own choice at checkout widens what is sent.
      consent: metadata.siumora_consent === "full" ? FULL_CONSENT : DEFAULT_CONSENT,
      identity: {
        ...(order.address.phone ? { phone: order.address.phone } : {}),
        ...(gaClientId ? { gaClientId } : {}),
      },
      // Meta dedupes within 48 hours of the event time: when it happened,
      // not when the worker gets round to it.
      eventTime: Math.floor((status === "delivered" ? Date.now() : new Date(wire.created_at).getTime()) / 1000),
    });

    // A row either way — "not configured" and "no client id" are facts the
    // ledger records rather than gaps nobody can explain.
    await recordTrackingEvent(pg, {
      eventId,
      eventName: event,
      destination: "ga4",
      payload: built.ga4 ?? { unsendable: "no ga client id captured" },
      orderId,
      status: built.ga4 && configured.ga4() ? "pending" : "skipped",
    });
    if (built.meta) {
      await recordTrackingEvent(pg, {
        eventId,
        eventName: event,
        destination: "meta",
        payload: built.meta,
        orderId,
        status: configured.meta() ? "pending" : "skipped",
      });
    }
  } catch (error) {
    logger.error(
      `order ${orderId} moved to ${status} but its message/conversion was not queued: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
