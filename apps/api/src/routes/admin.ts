import type { FastifyInstance } from "fastify";

import {
  invoiceSeriesHealth,
  ndrQueue,
  rtoBreakdown,
  statusCounts,
  maskPhone,
  summariseRevenue,
  type CartTotals,
  type Order,
} from "@siumora/core";
import { desc, schema } from "@siumora/db";

import { requireAdmin } from "../lib/auth.ts";

/**
 * Admin metrics.
 *
 * Reads only, and only for a signed-in operator. The allow-list is checked on
 * every request rather than baked into the session, so taking a number out of
 * `ADMIN_PHONES` closes the door immediately.
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
  server.get("/admin/metrics", async (request, reply) => {
    const viewer = await requireAdmin(request, reply);
    if (!viewer) return;

    const rows = await server.db
      .select()
      .from(schema.orders)
      .orderBy(desc(schema.orders.placedAt))
      .limit(1000);

    const orders = rows.map(toDomainOrder);

    reply.header("Cache-Control", "no-store");
    return {
      operator: maskPhone(viewer.customer.phone),
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
      recentOrders: rows.slice(0, 50),
    };
  });
}
