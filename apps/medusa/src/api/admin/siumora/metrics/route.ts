import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { invoiceSeriesHealth, ndrQueue, rtoBreakdown, statusCounts, summariseRevenue } from "@siumora/core";

import { loadDomainOrders } from "../../../../lib/domain-orders";
import { requireOperator } from "../../../../lib/operator-gate";
import { maskActorContact } from "../../../../modules/audit/audit";

/**
 * GET /admin/siumora/metrics — the ops dashboard read, ported from
 * apps/api/src/routes/admin.ts. Same core recipes over the same domain
 * orders (src/lib/domain-orders.ts), so transit value stays out of
 * recognised revenue exactly as the Fastify metrics keep it
 * (summariseRevenue recognises delivered only).
 *
 * Honesty over completeness: tracking/messages/privacy exist on the Fastify
 * side as outbox and privacy-request tables that have NOT crossed yet (wave
 * B rows 1 and 4). Those keys are served as explicit nulls rather than
 * omitted or faked, so the dashboard renders "not on this stack yet" and a
 * later port fills them in without a shape change. twoFactor mirrors the
 * Fastify totpState shape with enrolled:false for every operator — the TOTP
 * port is the operator-identity wave (pending row 2, waivered).
 */
export const AUTHENTICATE = false;

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "metrics:read");
  if (!operator) return;

  const records = await loadDomainOrders(req, { limit: 1000 });
  const orders = records.map((record) => record.order);

  res.setHeader("Cache-Control", "no-store");
  res.json({
    operator: maskActorContact(operator.contact),
    // The dashboard renders against this rather than guessing: a button
    // that 403s on click is worse than one that is not there.
    role: operator.role,
    permissions: operator.permissions,
    twoFactor: { enrolled: false, confirmedAt: null, recoveryCodesLeft: 0 },
    revenue: summariseRevenue(orders),
    byPincode: rtoBreakdown(orders, (order: (typeof orders)[number]) => order.address.pincode),
    byPayment: rtoBreakdown(orders, (order: (typeof orders)[number]) => order.paymentMethod),
    ndrQueue: ndrQueue(orders).map((order: (typeof orders)[number]) => ({
      number: order.number,
      attempts: order.deliveryAttempts ?? 0,
      pincode: order.address.pincode,
      reason: order.ndrReason,
    })),
    statuses: statusCounts(orders),
    invoiceSeries: invoiceSeriesHealth(orders),
    // Not on this stack yet — wave B rows 4 (outbox) and 1 (privacy).
    tracking: null,
    messages: null,
    privacy: null,
    recentOrders: orders.slice(0, 50).map((order: (typeof orders)[number]) => ({
      number: order.number,
      status: order.status,
      total: order.totals.total,
      paymentMethod: order.paymentMethod,
      pincode: order.address.pincode,
      placedAt: order.placedAt,
      invoiceNumber: order.invoiceNumber ?? null,
    })),
  });
}
