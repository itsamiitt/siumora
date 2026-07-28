import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  invoiceSeriesHealth,
  isAuditAction,
  ndrQueue,
  rtoBreakdown,
  statusCounts,
  maskPhone,
  permissionsFor,
  summariseRevenue,
  type CartTotals,
  type Order,
} from "@siumora/core";
import {
  desc,
  ordersMissingConversion,
  readAudit,
  schema,
  trackingHealth,
} from "@siumora/db";

import { requirePermission } from "../lib/auth.ts";

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
  /**
   * The audit log.
   *
   * Owner only, and readable rather than exportable. Somebody who can rewrite
   * history is somebody the log cannot testify against, so the route offers no
   * way to change it and the database refuses one anyway.
   */
  server.get("/admin/audit", async (request, reply) => {
    const viewer = await requirePermission(request, reply, "audit:read");
    if (!viewer) return;

    const query = z
      .object({
        action: z.string().optional(),
        actorPhone: z.string().optional(),
        subject: z.string().optional(),
      })
      .parse(request.query);

    const entries = await readAudit(server.db, {
      ...(query.action && isAuditAction(query.action) ? { action: query.action } : {}),
      ...(query.actorPhone ? { actorPhone: query.actorPhone } : {}),
      ...(query.subject ? { subject: query.subject } : {}),
    });

    reply.header("Cache-Control", "no-store");
    return {
      entries: entries.map((entry) => ({
        ...entry,
        // Masked for reading. Full numbers are in the table for accountability;
        // a screen anybody can shoulder-surf does not need them.
        actorPhone: maskPhone(entry.actorPhone),
      })),
    };
  });

  server.get("/admin/metrics", async (request, reply) => {
    const viewer = await requirePermission(request, reply, "metrics:read");
    if (!viewer) return;

    const rows = await server.db
      .select()
      .from(schema.orders)
      .orderBy(desc(schema.orders.placedAt))
      .limit(1000);

    const orders = rows.map(toDomainOrder);

    // Doc 08 §8: order-to-conversion parity, as a query rather than a metric
    // somebody eyeballs. Any gap here is revenue the ad platforms cannot see.
    const [health, missingConversions] = await Promise.all([
      trackingHealth(server.db),
      ordersMissingConversion(server.db),
    ]);

    reply.header("Cache-Control", "no-store");
    return {
      operator: maskPhone(viewer.customer.phone),
      // The dashboard renders against this rather than guessing: a button that
      // 403s on click is worse than one that is not there.
      role: viewer.role,
      permissions: viewer.role ? permissionsFor(viewer.role) : [],
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
      tracking: { health, missingConversions },
      recentOrders: rows.slice(0, 50),
    };
  });
}
