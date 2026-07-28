import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { canTransition, type OrderStatus } from "@siumora/core";
import { getOrderByNumber } from "@siumora/db";

import { setOrderStatus } from "../lib/invoicing.ts";
import { advance } from "./orders.ts";
import { verifyCourierSignature, verifyRazorpaySignature } from "../lib/webhooks.ts";

/**
 * Inbound webhooks.
 *
 * Two properties matter and both are enforced here:
 *
 * 1. **Signed.** A payment webhook decides whether an order is paid. Without a
 *    signature check, anyone who learns the URL can mark any order paid.
 * 2. **Idempotent.** Providers retry, sometimes for days, and deliver
 *    out of order. Replaying a `payment.captured` must not confirm an order
 *    twice or issue a second invoice number.
 */

interface RawBodyRequest {
  rawBody?: string;
}

export async function registerWebhookRoutes(server: FastifyInstance) {
  server.post("/webhooks/razorpay", async (request, reply) => {
    const raw = (request as unknown as RawBodyRequest).rawBody ?? "";
    const signature = request.headers["x-razorpay-signature"];

    const verified = verifyRazorpaySignature(
      raw,
      typeof signature === "string" ? signature : undefined,
      server.config.razorpayWebhookSecret,
    );
    if (!verified.ok) {
      // 401, and no detail: telling a caller *why* the signature failed helps
      // them forge a better one.
      return reply.code(401).send({ error: "invalid_signature" });
    }

    const body = z
      .object({
        event: z.string(),
        payload: z.object({
          payment: z
            .object({
              entity: z.object({
                id: z.string(),
                notes: z.object({ order_number: z.string() }).partial(),
              }),
            })
            .optional(),
        }),
      })
      .parse(request.body);

    const orderNumber = body.payload.payment?.entity.notes?.order_number;
    if (!orderNumber) {
      // Acknowledge rather than error: a payload we cannot route is not the
      // provider's fault to retry forever.
      return { ok: true, ignored: "no order reference" };
    }

    const order = await getOrderByNumber(server.db, orderNumber);
    if (!order) return { ok: true, ignored: "unknown order" };

    if (body.event !== "payment.captured") {
      return { ok: true, ignored: body.event };
    }

    // Already confirmed: a redelivery, which is expected and must be a no-op.
    if (!canTransition(order.status as OrderStatus, "confirmed")) {
      return { ok: true, replayed: true, status: order.status };
    }

    const updated = await setOrderStatus(server, order, "confirmed");

    return { ok: true, orderNumber, status: updated.status };
  });

  server.post("/webhooks/courier", async (request, reply) => {
    const raw = (request as unknown as RawBodyRequest).rawBody ?? "";
    const signature = request.headers["x-courier-signature"];

    const verified = verifyCourierSignature(
      raw,
      typeof signature === "string" ? signature : undefined,
      server.config.courierWebhookSecret,
    );
    if (!verified.ok) return reply.code(401).send({ error: "invalid_signature" });

    const body = z
      .object({
        order_number: z.string(),
        status: z.enum([
          "processing",
          "shipped",
          "out_for_delivery",
          "delivered",
          "ndr",
          "rto",
        ]),
        ndr_reason: z
          .enum([
            "customer_unavailable",
            "phone_unreachable",
            "address_incomplete",
            "customer_refused",
            "payment_not_ready",
            "premises_closed",
          ])
          .optional(),
      })
      .parse(request.body);

    const order = await getOrderByNumber(server.db, body.order_number);
    if (!order) return { ok: true, ignored: "unknown order" };

    // Couriers redeliver and reorder. A status the order has already passed is
    // acknowledged rather than forced through an illegal transition.
    if (!canTransition(order.status as OrderStatus, body.status)) {
      return { ok: true, replayed: true, status: order.status };
    }

    // Called directly rather than re-injected through the HTTP route: that
    // route now authorises the caller, and a signed courier webhook has no
    // session and no order access key. The signature is the authorisation.
    const result = await advance(server, body.order_number, body.status, body.ndr_reason);

    return { ok: result.ok, status: body.status };
  });
}
