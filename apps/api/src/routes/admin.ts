import type { FastifyInstance } from "fastify";

import {
  invoiceSeriesHealth,
  ndrQueue,
  rtoBreakdown,
  statusCounts,
  summariseRevenue,
  type CartTotals,
  type Order,
} from "@siumora/core";
import { desc, schema } from "@siumora/db";

/**
 * Admin metrics.
 *
 * Reads only. There is no authentication yet, so the route announces that in
 * its own response rather than looking like a secured endpoint — a caller
 * should not have to guess whether something is protecting this.
 */

/** Rehydrate the domain order shape the metrics functions expect. */
function toDomainOrder(row: typeof schema.orders.$inferSelect): Order {
  const totals: CartTotals = {
    mrpTotal: row.subtotal,
    subtotal: row.subtotal,
    savings: 0,
    shipping: row.shipping,
    codFee: row.codFee,
    total: row.total,
    gst: {
      taxableValue: row.taxableValue,
      cgst: row.cgst,
      sgst: row.sgst,
      igst: row.igst,
      totalTax: row.cgst + row.sgst + row.igst,
      total: row.total,
    },
    itemCount: 0,
  };

  return {
    id: row.id,
    number: row.number,
    status: row.status as Order["status"],
    lines: [],
    totals,
    paymentMethod: row.paymentMethod as Order["paymentMethod"],
    address: row.address as Order["address"],
    interState: row.interState,
    placedAt: row.placedAt.toISOString(),
    eventId: row.eventId,
    ...(row.deliveredAt ? { deliveredAt: row.deliveredAt.toISOString() } : {}),
    deliveryAttempts: row.deliveryAttempts,
    ...(row.ndrReason ? { ndrReason: row.ndrReason as Order["ndrReason"] } : {}),
    ...(row.invoiceNumber ? { invoiceNumber: row.invoiceNumber } : {}),
  };
}

export async function registerAdminRoutes(server: FastifyInstance) {
  server.get("/admin/metrics", async (_request, reply) => {
    const rows = await server.db
      .select()
      .from(schema.orders)
      .orderBy(desc(schema.orders.placedAt))
      .limit(1000);

    const orders = rows.map(toDomainOrder);

    reply.header("Cache-Control", "no-store");
    return {
      // Stated in the payload so a consumer cannot mistake this for a
      // protected endpoint.
      unauthenticated: true,
      revenue: summariseRevenue(orders),
      byPincode: rtoBreakdown(orders, (order) => order.address.pincode),
      byPayment: rtoBreakdown(orders, (order) => order.paymentMethod),
      ndrQueue: ndrQueue(orders).map((order) => ({
        number: order.number,
        attempts: order.deliveryAttempts ?? 0,
        pincode: order.address.pincode,
        reason: order.ndrReason,
      })),
      statuses: statusCounts(orders),
      invoiceSeries: invoiceSeriesHealth(orders),
    };
  });
}
