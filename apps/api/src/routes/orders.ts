import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  canTransition,
  evaluateReturn,
  financialYear,
  hsnSummary,
  invoiceNumber,
  ndrState,
  outcomeFor,
  summariseInvoice,
  type CartLine,
  type NdrReason,
  type OrderStatus,
} from "@siumora/core";
import { eq, getOrderByNumber, schema, sql } from "@siumora/db";

import { isUniqueViolation } from "../lib/pg-errors.ts";

/**
 * Orders, returns and delivery outcomes.
 *
 * Every transition is validated against the same state machine the storefront
 * uses. The API is the enforcement point: a client that asks to mark an unpaid
 * order delivered is refused here, not merely discouraged in the UI.
 */

const numberParam = z.object({ number: z.string().min(3).max(32) });

/** Rebuild the domain cart lines an order was invoiced from. */
function toCartLines(
  lines: Awaited<ReturnType<typeof getOrderByNumber>> extends infer T
    ? T extends { lines: infer L }
      ? L
      : never
    : never,
): CartLine[] {
  return (lines as Array<Record<string, unknown>>).map((line) => ({
    variantId: line.variantId as string,
    sku: line.sku as string,
    productHandle: line.productHandle as string,
    title: line.title as string,
    variantTitle: line.variantTitle as string,
    imageUrl: line.imageUrl as string,
    mrp: line.mrp as number,
    unitPrice: line.unitPrice as number,
    quantity: line.quantity as number,
    gstSlab: line.gstSlab as CartLine["gstSlab"],
    hsn: line.hsn as string,
    piercedJewellery: line.piercedJewellery as boolean,
  }));
}

export async function registerOrderRoutes(server: FastifyInstance) {
  server.get("/orders/:number", async (request, reply) => {
    const { number } = numberParam.parse(request.params);
    const order = await getOrderByNumber(server.db, number);
    if (!order) return reply.code(404).send({ error: "not_found" });

    const lines = toCartLines(order.lines);
    const rows = hsnSummary(lines, { interState: order.interState });

    const [openReturn] = await server.db
      .select()
      .from(schema.returnRequests)
      .where(eq(schema.returnRequests.orderId, order.id));

    // Never cached: an order page is per-customer and changes as it moves.
    reply.header("Cache-Control", "no-store");
    return {
      order,
      invoice: { rows, totals: summariseInvoice(rows) },
      return: openReturn ?? null,
    };
  });

  /** Confirm a held COD order. Stands in for the WhatsApp OTP callback. */
  server.post("/orders/:number/confirm", async (request, reply) => {
    const { number } = numberParam.parse(request.params);

    const order = await getOrderByNumber(server.db, number);
    if (!order) return reply.code(404).send({ error: "not_found" });

    if (!canTransition(order.status as OrderStatus, "confirmed")) {
      return reply.code(409).send({
        error: "illegal_transition",
        message: `Cannot confirm an order that is ${order.status}.`,
      });
    }

    // The invoice number is allocated here, not at placement: a held order
    // that is never confirmed must not burn a number from a gapless series.
    const updated = await server.db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE orders IN SHARE ROW EXCLUSIVE MODE`);
      const fy = financialYear(order.placedAt);

      const next = await tx.execute(
        sql`SELECT COALESCE(MAX(invoice_sequence), 0) + 1 AS next FROM orders WHERE financial_year = ${fy}`,
      );
      const sequence = Number((next.rows[0] as { next: number }).next);

      const [row] = await tx
        .update(schema.orders)
        .set({
          status: "confirmed",
          ...(order.invoiceNumber
            ? {}
            : {
                invoiceNumber: invoiceNumber(sequence, order.placedAt),
                invoiceSequence: sequence,
                financialYear: fy,
              }),
        })
        .where(eq(schema.orders.id, order.id))
        .returning();

      return row!;
    });

    return { ok: true, order: updated };
  });

  /** Courier-driven transition. The real driver is the webhook below. */
  server.post("/orders/:number/status", async (request, reply) => {
    const { number } = numberParam.parse(request.params);
    const body = z
      .object({
        status: z.enum([
          "confirmed",
          "processing",
          "shipped",
          "out_for_delivery",
          "delivered",
          "ndr",
          "rto",
          "cancelled",
          "returned",
        ]),
        ndrReason: z
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

    const result = await advance(server, number, body.status, body.ndrReason);
    if (!result.ok) {
      return reply.code(result.code).send({ error: result.error, message: result.message });
    }
    return { ok: true, order: result.order };
  });

  /** The customer's answer to a failed delivery. */
  server.post("/orders/:number/ndr", async (request, reply) => {
    const { number } = numberParam.parse(request.params);
    const body = z
      .object({ action: z.enum(["reattempt", "update_address", "cancel"]) })
      .parse(request.body);

    const order = await getOrderByNumber(server.db, number);
    if (!order) return reply.code(404).send({ error: "not_found" });
    if (order.status !== "ndr") {
      return reply
        .code(409)
        .send({ error: "not_awaiting_answer", message: "This order is not in NDR." });
    }

    if (body.action === "cancel") {
      const result = await advance(server, number, "cancelled");
      return result.ok
        ? { ok: true, order: result.order }
        : reply.code(result.code).send({ error: result.error });
    }

    const state = ndrState(
      order.deliveryAttempts,
      (order.ndrReason ?? "customer_unavailable") as NdrReason,
    );
    if (!state.recoverable) {
      return reply.code(409).send({
        error: "not_recoverable",
        message: "The courier cannot attempt this delivery again.",
      });
    }

    const result = await advance(server, number, "out_for_delivery");
    return result.ok
      ? { ok: true, order: result.order }
      : reply.code(result.code).send({ error: result.error });
  });

  server.post("/orders/:number/returns", async (request, reply) => {
    const { number } = numberParam.parse(request.params);
    const body = z
      .object({
        variantIds: z.array(z.uuid()).min(1),
        reason: z.enum([
          "damaged",
          "wrong_item",
          "not_as_described",
          "changed_mind",
          "size_or_fit",
          "quality",
        ]),
        resolution: z.enum(["refund", "exchange"]),
        sealIntact: z.boolean().optional(),
        note: z.string().max(1000).optional(),
      })
      .parse(request.body);

    const order = await getOrderByNumber(server.db, number);
    if (!order) return reply.code(404).send({ error: "not_found" });

    const lines = toCartLines(order.lines).filter((line) =>
      body.variantIds.includes(line.variantId),
    );
    if (lines.length === 0) {
      return reply
        .code(400)
        .send({ error: "not_on_order", message: "Those pieces are not on this order." });
    }

    const eligibility = evaluateReturn({
      orderStatus: order.status as OrderStatus,
      deliveredAt: order.deliveredAt ?? order.placedAt,
      now: new Date(),
      reason: body.reason,
      // Judged against the strictest piece: one pierced item makes the
      // hygiene rule apply to the whole request.
      isPiercedJewellery: lines.some((line) => line.piercedJewellery),
      sealIntact: body.sealIntact,
      paymentMethod: order.paymentMethod as "cod" | "upi",
    });

    if (!eligibility.eligible) {
      return reply
        .code(409)
        .send({ error: "not_eligible", message: eligibility.refusal });
    }

    try {
      const [created] = await server.db
        .insert(schema.returnRequests)
        .values({
          orderId: order.id,
          variantIds: body.variantIds,
          reason: body.reason,
          resolution: body.resolution,
          status: "approved",
          refundTo: eligibility.refundTo ?? "original_payment_method",
          freeReturnShipping: eligibility.freeReturnShipping,
          ...(body.note ? { note: body.note } : {}),
        })
        .returning();

      return { ok: true, return: created };
    } catch (error) {
      // The partial unique index refuses a second open return on one order,
      // which would otherwise refund the same piece twice.
      if (isUniqueViolation(error)) {
        return reply
          .code(409)
          .send({ error: "already_open", message: "A return is already open on this order." });
      }
      throw error;
    }
  });
}

type AdvanceResult =
  | { ok: true; order: unknown }
  | { ok: false; code: 404 | 409; error: string; message?: string };

/**
 * Move an order along, applying the NDR rules.
 *
 * An attempt that cannot be recovered continues straight to RTO, so the stored
 * status never says "delivery attempted" on a parcel already travelling back.
 */
async function advance(
  server: FastifyInstance,
  number: string,
  to: OrderStatus,
  ndrReason?: NdrReason,
): Promise<AdvanceResult> {
  const order = await getOrderByNumber(server.db, number);
  if (!order) return { ok: false, code: 404, error: "not_found" };

  const from = order.status as OrderStatus;
  if (!canTransition(from, to)) {
    return {
      ok: false,
      code: 409,
      error: "illegal_transition",
      message: `Cannot move from ${from} to ${to}.`,
    };
  }

  const attempts = to === "ndr" ? order.deliveryAttempts + 1 : order.deliveryAttempts;
  const reason = to === "ndr" ? (ndrReason ?? order.ndrReason ?? "customer_unavailable") : order.ndrReason;

  let status: OrderStatus = to;
  if (to === "ndr" && outcomeFor(attempts, reason as NdrReason) === "rto") {
    status = "rto";
  }

  const [updated] = await server.db
    .update(schema.orders)
    .set({
      status,
      deliveryAttempts: attempts,
      ...(reason ? { ndrReason: reason } : {}),
      ...(to === "delivered" ? { deliveredAt: new Date() } : {}),
    })
    .where(eq(schema.orders.id, order.id))
    .returning();

  if (to === "ndr") {
    await server.db.insert(schema.ndrEvents).values({
      orderId: order.id,
      reason: reason as string,
      attempt: attempts,
    });
  }

  return { ok: true, order: updated };
}
