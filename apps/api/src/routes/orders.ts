import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  canTransition,
  evaluateReturn,
  hsnSummary,
  ndrState,
  outcomeFor,
  restockTiming,
  summariseInvoice,
  type CartLine,
  type NdrReason,
  type OrderStatus,
} from "@siumora/core";
import {
  eq,
  getOrderByNumber,
  inArray,
  listAwaitingRestock,
  listOrdersForCustomer,
  restockOrder,
  schema,
} from "@siumora/db";

import { requireAdmin, requireCustomer, resolveViewer, type Viewer } from "../lib/auth.ts";
import { setOrderStatus } from "../lib/invoicing.ts";
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

/** An order row as far as authorisation is concerned. */
interface OwnedOrder {
  readonly customerId: string | null;
  readonly accessKey: string;
}

/**
 * May this caller see this order?
 *
 * Order numbers are a readable sequence, so knowing one is not evidence of
 * anything — SIU-00001 and a for-loop would otherwise walk every customer's
 * name, address and phone number. Three things grant access: owning the order,
 * holding the access key issued at checkout, or being an operator.
 */
function mayAccess(order: OwnedOrder, viewer: Viewer | undefined, key?: string): boolean {
  if (viewer?.isAdmin) return true;
  if (viewer && order.customerId && order.customerId === viewer.customer.id) {
    return true;
  }
  return Boolean(key) && key === order.accessKey;
}

const accessQuery = z.object({ key: z.uuid().optional() });

export async function registerOrderRoutes(server: FastifyInstance) {
  /** The signed-in customer's own orders. */
  server.get("/orders", async (request, reply) => {
    const viewer = await requireCustomer(request, reply);
    if (!viewer) return;

    const rows = await listOrdersForCustomer(server.db, viewer.customer.id);

    // Lines come along in one extra query rather than N. Without them the
    // account page can only say "0 pieces" against every order.
    const ids = rows.map((row) => row.id);
    const lines = ids.length
      ? await server.db
          .select()
          .from(schema.orderLines)
          .where(inArray(schema.orderLines.orderId, ids))
      : [];

    const byOrder = new Map<string, typeof lines>();
    for (const line of lines) {
      const bucket = byOrder.get(line.orderId) ?? [];
      bucket.push(line);
      byOrder.set(line.orderId, bucket);
    }

    reply.header("Cache-Control", "no-store");
    return {
      orders: rows.map((row) => ({ ...row, lines: byOrder.get(row.id) ?? [] })),
    };
  });

  server.get("/orders/:number", async (request, reply) => {
    const { number } = numberParam.parse(request.params);
    const { key } = accessQuery.parse(request.query);

    const order = await getOrderByNumber(server.db, number);
    if (!order) return reply.code(404).send({ error: "not_found" });

    const viewer = await resolveViewer(request);
    if (!mayAccess(order, viewer, key)) {
      // 404, not 403: a 403 would confirm the order number is real, which is
      // exactly the fact the enumeration is after.
      return reply.code(404).send({ error: "not_found" });
    }

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

  /**
   * Load an order the caller is entitled to, or reply and return undefined.
   *
   * Every route that acts on an order goes through this. Authorising the read
   * but not the write would leave the interesting half open.
   */
  async function authorised(
    request: FastifyRequest,
    reply: FastifyReply,
    number: string,
  ) {
    const { key } = accessQuery.parse(request.query);
    const order = await getOrderByNumber(server.db, number);
    if (!order) {
      await reply.code(404).send({ error: "not_found" });
      return undefined;
    }

    const viewer = await resolveViewer(request);
    if (!mayAccess(order, viewer, key)) {
      await reply.code(404).send({ error: "not_found" });
      return undefined;
    }

    return { order, viewer };
  }

  /** Confirm a held COD order. Stands in for the WhatsApp OTP callback. */
  server.post("/orders/:number/confirm", async (request, reply) => {
    const { number } = numberParam.parse(request.params);

    const found = await authorised(request, reply, number);
    if (!found) return;
    const { order } = found;

    if (!canTransition(order.status as OrderStatus, "confirmed")) {
      return reply.code(409).send({
        error: "illegal_transition",
        message: `Cannot confirm an order that is ${order.status}.`,
      });
    }

    // The invoice number is allocated on confirmation, not at placement: a
    // held order that is never confirmed must not burn a number from a
    // gapless series.
    const updated = await setOrderStatus(server, order, "confirmed");

    return { ok: true, order: updated };
  });

  /**
   * Courier-driven transition. The real driver is the signed webhook.
   *
   * Operators may always call it. Everyone else may only when the courier
   * simulation is switched on, because marking your own parcel delivered opens
   * the return window and recognises the revenue — a customer must not be able
   * to do that to a parcel that is still on a van.
   */
  server.post("/orders/:number/status", async (request, reply) => {
    const { number } = numberParam.parse(request.params);

    const found = await authorised(request, reply, number);
    if (!found) return;

    if (!found.viewer?.isAdmin && !server.config.courierSimulation) {
      return reply.code(403).send({
        error: "not_an_operator",
        message: "Only the courier or an operator can move this order.",
      });
    }

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

    const found = await authorised(request, reply, number);
    if (!found) return;
    const { order } = found;

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

  /**
   * The restock queue: ended orders whose goods have not gone back on the shelf.
   *
   * Operators only. It is a stock figure, and stock is what the whole oversell
   * guard exists to protect.
   */
  server.get("/admin/restock-queue", async (request, reply) => {
    const viewer = await requireAdmin(request, reply);
    if (!viewer) return;

    const rows = await listAwaitingRestock(server.db);
    reply.header("Cache-Control", "no-store");
    return {
      orders: rows.map((row) => ({
        number: row.number,
        status: row.status,
        placedAt: row.placedAt,
        total: row.total,
      })),
    };
  });

  /**
   * Confirm goods received and put them back.
   *
   * Deliberately a separate step from the status change. A parcel marked RTO is
   * on a van, not on a shelf, and counting it as sellable promises a piece that
   * is days away and may arrive damaged. Somebody has to have it in their hands.
   */
  server.post("/orders/:number/restock", async (request, reply) => {
    const viewer = await requireAdmin(request, reply);
    if (!viewer) return;

    const { number } = numberParam.parse(request.params);
    const order = await getOrderByNumber(server.db, number);
    if (!order) return reply.code(404).send({ error: "not_found" });

    const result = await restockOrder(server.db, order.id);

    if (!result.restocked) {
      // A repeat click is not an error — it is somebody checking. Say what the
      // state is rather than failing.
      return reply.code(result.reason === "already_restocked" ? 200 : 409).send({
        ok: false,
        reason: result.reason,
        message:
          result.reason === "already_restocked"
            ? "These goods are already back in stock."
            : "This order is not owed any stock back.",
      });
    }

    return { ok: true, units: result.units };
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

    const found = await authorised(request, reply, number);
    if (!found) return;
    const { order } = found;

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

export type AdvanceResult =
  | { ok: true; order: unknown }
  | { ok: false; code: 404 | 409; error: string; message?: string };

/**
 * Move an order along, applying the NDR rules.
 *
 * An attempt that cannot be recovered continues straight to RTO, so the stored
 * status never says "delivery attempted" on a parcel already travelling back.
 */
export async function advance(
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

  // Routed through setOrderStatus so a confirmation reached this way raises an
  // invoice exactly like one reached through the payment webhook.
  const updated = await setOrderStatus(server, order, status, {
    deliveryAttempts: attempts,
    ...(reason ? { ndrReason: reason } : {}),
    ...(to === "delivered" ? { deliveredAt: new Date() } : {}),
  });

  // Stock left at placement; this is the counterpart. Only goods that never
  // reached a courier go back automatically — a parcel travelling home is not
  // sellable until somebody has it, so that waits for the restock call.
  if (restockTiming(from, status) === "immediate") {
    await restockOrder(server.db, order.id);
  }


  if (to === "ndr") {
    await server.db.insert(schema.ndrEvents).values({
      orderId: order.id,
      reason: reason as string,
      attempt: attempts,
    });
  }

  return { ok: true, order: updated };
}
