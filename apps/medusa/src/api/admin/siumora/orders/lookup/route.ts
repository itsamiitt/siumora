import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { requireOperator } from "../../../../../lib/operator-gate";
import {
  countNdrAttempts,
  findOpenReturn,
  getShipment,
  getStatusRow,
  type SqlClient,
} from "../../../../../modules/returns-ndr/data";
import {
  WALKABLE_STATUSES,
  initialSiumoraStatus,
  returnEnvelope,
} from "../../../../../modules/returns-ndr/lifecycle";
import { trackingUrl } from "../../../../../modules/shiprocket-fulfillment/decide";
import { GIFT_MESSAGE_KEY, codFeeOf, paymentMethodOf } from "../../../../../modules/siumora-order/checkout-rules";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { canTransition, type OrderStatus } from "@siumora/core";

/**
 * GET /admin/siumora/orders/lookup?order_id=<medusa order id> — the ops card
 * for one order, keyed by the id the Admin order-detail page has in hand
 * (the order-ops widget's read). Serves the SIU number, the status truth,
 * the legal next transitions (so the widget renders real buttons, not ones
 * that 409 on click), NDR attempts, and the open return if any.
 */

export const AUTHENTICATE = false;

/** The Razorpay payment id behind a prepaid order, for the support desk. */
function paymentReference(
  collections: Array<{ payments?: Array<{ data?: Record<string, unknown> | null } | null> | null } | null> | null | undefined,
): string | null {
  for (const collection of collections ?? []) {
    for (const payment of collection?.payments ?? []) {
      const id = payment?.data?.razorpay_payment_id;
      if (typeof id === "string") return id;
    }
  }
  return null;
}

interface IdentityRow {
  order_id: string;
  order_number: string;
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "metrics:read");
  if (!operator) return;

  const orderId = typeof req.query.order_id === "string" ? req.query.order_id : "";
  if (!orderId) {
    res.status(400).json({
      error: "invalid_request",
      message: "order_id: expected a Medusa order id",
    });
    return;
  }

  const pg = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as SqlClient;

  const identityResult = await pg.raw(
    `SELECT order_id, order_number FROM siumora_order_identity
      WHERE order_id = ? AND deleted_at IS NULL`,
    [orderId],
  );
  const identity = identityResult.rows[0] as IdentityRow | undefined;
  if (!identity) {
    // A draft order made in the stock admin has no SIU identity — the
    // widget renders "not a storefront order" rather than an error.
    res.status(404).json({ error: "not_found" });
    return;
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "status", "metadata", "shipping_methods.data", "payment_collections.payments.data"],
    filters: { id: orderId },
  });
  const order = orders[0] as
    | {
        status: string;
        metadata?: Record<string, unknown> | null;
        shipping_methods?: Array<{ data?: Record<string, unknown> | null } | null> | null;
        payment_collections?: Array<{ payments?: Array<{ data?: Record<string, unknown> | null } | null> | null } | null> | null;
      }
    | undefined;
  if (!order) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const [statusRow, openReturn, attempts, shipment] = await Promise.all([
    getStatusRow(pg, orderId),
    findOpenReturn(pg, orderId),
    countNdrAttempts(pg, orderId),
    getShipment(pg, orderId),
  ]);
  const status = (statusRow?.status ??
    initialSiumoraStatus(order.status)) as OrderStatus;

  res.setHeader("Cache-Control", "no-store");
  res.json({
    number: identity.order_number,
    status,
    ndrReason: statusRow?.ndr_reason ?? null,
    deliveryAttempts: attempts,
    // Real buttons only: the statuses core's machine allows from here.
    nextStatuses: WALKABLE_STATUSES.filter((to: OrderStatus) =>
      canTransition(status, to),
    ),
    permissions: operator.permissions,
    return: openReturn
      ? { ...returnEnvelope(openReturn).return, payoutReference: openReturn.payout_reference ?? null }
      : null,
    // Plan 16 B21: what to write on the card in the parcel.
    giftMessage:
      typeof order.metadata?.[GIFT_MESSAGE_KEY] === "string" ? (order.metadata[GIFT_MESSAGE_KEY] as string) : null,
    // Plan 16 B29: rto/returned goods not yet back on the shelf.
    awaitsRestock: (status === "rto" || status === "returned") && !statusRow?.restocked_at,
    // Plan 16 B26: how it was paid and where the parcel is, for the card.
    payment: {
      method: paymentMethodOf(order.metadata),
      codFee: codFeeOf(order.shipping_methods),
      reference: paymentReference(order.payment_collections),
    },
    shipment: shipment?.awb
      ? {
          awb: shipment.awb,
          courier: shipment.courier,
          trackingUrl: trackingUrl(shipment.awb),
          pickupScheduled: shipment.pickup_scheduled,
        }
      : null,
  });
}
