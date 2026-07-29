import type { FastifyInstance } from "fastify";

import {
  NDR_REASON_LABELS,
  printRupees,
  templateForStatus,
  type NdrReason,
  type ShippingAddress,
} from "@siumora/core";
import { enqueueNotification, schema } from "@siumora/db";

/**
 * Queue the message an order transition owes its customer.
 *
 * Called from the same funnel that allocates the invoice number and queues the
 * conversion, for the same reason: this is the one place a status changes, so
 * no path can move an order without the customer being told. Queueing from each
 * caller instead is how the courier webhook silently stops sending dispatch
 * notices.
 *
 * Never throws into the caller. An order that genuinely shipped must not be
 * un-shipped because a template variable was missing.
 */
export async function queueOrderMessage(
  server: FastifyInstance,
  order: typeof schema.orders.$inferSelect,
): Promise<{ queued: boolean; template?: string }> {
  const templateKey = templateForStatus(order.status);
  if (!templateKey) return { queued: false };

  try {
    const address = order.address as ShippingAddress;
    if (!address?.phone) return { queued: false };

    const result = await enqueueNotification(server.db, {
      // Order and status, not a fresh id: a replayed courier webhook or a
      // double-clicked status change must produce one message, and the pair is
      // exactly what "this happened to this order" means.
      eventKey: `${order.id}:${order.status}`,
      templateKey,
      recipient: address.phone,
      variables: variablesFor(templateKey, order, address),
      orderId: order.id,
      ...(order.customerId ? { customerId: order.customerId } : {}),
    });

    return { queued: result.queued, template: templateKey };
  } catch (error) {
    server.log?.error?.(
      { err: error, order: order.number },
      "notification not queued",
    );
    return { queued: false };
  }
}

/**
 * The variables each template needs.
 *
 * Assembled from the order rather than looked up later, because the message is
 * about the order as it was when it moved — a courier renamed or an address
 * corrected afterwards should not rewrite the notice that already went.
 */
function variablesFor(
  templateKey: string,
  order: typeof schema.orders.$inferSelect,
  address: ShippingAddress,
): Record<string, string | number> {
  const base = {
    // First name only: "Hi Asha Menon" reads like a bank.
    name: (address.name ?? "there").split(" ")[0] ?? "there",
    orderNumber: order.number,
  };

  switch (templateKey) {
    case "order_confirmed":
      return { ...base, total: `INR ${printRupees(order.total)}` };
    case "order_shipped":
      // The real courier and AWB once a booking stored them; the honest
      // placeholders otherwise — `renderTemplate` refuses an empty variable,
      // so this can never silently send "shipped with  ".
      return {
        ...base,
        courier: order.courierName ?? "our courier partner",
        trackingId: order.awbCode ?? order.number,
      };
    case "delivery_failed":
      return {
        ...base,
        reason: order.ndrReason
          ? (NDR_REASON_LABELS[order.ndrReason as NdrReason] ?? "we could not reach you")
          : "we could not reach you",
      };
    default:
      return base;
  }
}
