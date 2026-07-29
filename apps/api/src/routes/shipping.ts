import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { canTransition, type OrderStatus, type ShippingAddress } from "@siumora/core";
import { stateByCode } from "@siumora/in-locale";
import { eq, getOrderByNumber, schema } from "@siumora/db";

import { audit, requirePermission } from "../lib/auth.ts";
import { setOrderStatus } from "../lib/invoicing.ts";
import type { CreateShipmentInput } from "../lib/shiprocket.ts";

/**
 * Booking (plan W1 logistics).
 *
 * An operator action: create the courier order, take an AWB, schedule the
 * pickup, and move the order to `processing` with the real tracking id on it —
 * the shipped notice then carries a courier name and an AWB instead of the
 * honest placeholders. The tracking webhook drives everything after.
 */

/** Jewellery ships small. Overridable per booking for the outsized parcel. */
const DEFAULT_WEIGHT_KG = 0.3;
const DEFAULT_DIMENSIONS_CM = { length: 12, breadth: 10, height: 4 };

export function shipmentInputFor(
  order: {
    number: string;
    placedAt: Date;
    address: unknown;
    paymentMethod: string;
    subtotal: number;
    lines: ReadonlyArray<{
      title: string;
      sku: string;
      quantity: number;
      unitPrice: number;
      hsn: string;
    }>;
  },
  options: {
    pickupLocation: string;
    weightKg?: number;
    dimensionsCm?: { length: number; breadth: number; height: number };
  },
): CreateShipmentInput | { error: string } {
  const address = order.address as ShippingAddress;
  const state = stateByCode(address.stateCode);
  if (!state) return { error: `unknown state code ${address.stateCode}` };

  return {
    orderNumber: order.number,
    orderDate: order.placedAt.toISOString().slice(0, 10),
    pickupLocation: options.pickupLocation,
    address: {
      name: address.name,
      phone: address.phone,
      line1: address.line1,
      city: address.city,
      stateName: state.name,
      pincode: address.pincode,
    },
    items: order.lines.map((line) => ({
      name: line.title,
      sku: line.sku,
      units: line.quantity,
      // Rupees: the courier's API takes decimals, the ledger keeps paise.
      sellingPrice: line.unitPrice / 100,
      hsn: line.hsn,
    })),
    paymentMethod: order.paymentMethod === "cod" ? "COD" : "Prepaid",
    subTotal: order.subtotal / 100,
    weightKg: options.weightKg ?? DEFAULT_WEIGHT_KG,
    dimensionsCm: options.dimensionsCm ?? DEFAULT_DIMENSIONS_CM,
  };
}

export async function registerShippingRoutes(server: FastifyInstance): Promise<void> {
  const bookSchema = z
    .object({
      weightKg: z.number().positive().max(30).optional(),
      dimensionsCm: z
        .object({
          length: z.number().positive().max(120),
          breadth: z.number().positive().max(120),
          height: z.number().positive().max(120),
        })
        .optional(),
    })
    .optional();

  server.post("/orders/:number/ship", async (request, reply) => {
    const viewer = await requirePermission(request, reply, "orders:write");
    if (!viewer) return;

    const { number } = z.object({ number: z.string() }).parse(request.params);
    const body = bookSchema.parse(request.body ?? {}) ?? {};

    if (!server.shipping) {
      return reply.code(503).send({
        error: "shipping_not_configured",
        message: "No courier account is connected in this environment.",
      });
    }

    const order = await getOrderByNumber(server.db, number);
    if (!order) return reply.code(404).send({ error: "not_found" });

    if (order.awbCode) {
      return reply.code(409).send({
        error: "already_booked",
        message: `Already travelling as ${order.awbCode} with ${order.courierName ?? "the courier"}.`,
      });
    }
    if (!canTransition(order.status as OrderStatus, "processing")) {
      return reply.code(409).send({
        error: "illegal_transition",
        message: `Cannot book a shipment for an order that is ${order.status}.`,
      });
    }

    // Resume-aware: a booking that got its Shiprocket order but no AWB (a
    // serviceability or wallet hiccup) retries from the AWB step instead of
    // creating a duplicate courier order.
    let shipmentId = order.shiprocketShipmentId;
    let shiprocketOrderId = order.shiprocketOrderId;
    if (!shipmentId) {
      const input = shipmentInputFor(order, {
        pickupLocation: server.config.shiprocketPickupLocation ?? "Primary",
        ...(body.weightKg ? { weightKg: body.weightKg } : {}),
        ...(body.dimensionsCm ? { dimensionsCm: body.dimensionsCm } : {}),
      });
      if ("error" in input) {
        return reply.code(422).send({ error: "unshippable", message: input.error });
      }

      const created = await server.shipping.createOrder(input);
      if (!created.ok) {
        return reply.code(502).send({ error: "booking_failed", message: created.error });
      }
      shipmentId = created.shipmentId;
      shiprocketOrderId = created.orderId;
      await server.db
        .update(schema.orders)
        .set({ shiprocketOrderId: created.orderId, shiprocketShipmentId: created.shipmentId })
        .where(eq(schema.orders.id, order.id));
    }

    const assigned = await server.shipping.assignAwb(shipmentId);
    if (!assigned.ok) {
      // The courier order stands; this call is retried by hitting the route
      // again once the panel-side problem (wallet, serviceability) is fixed.
      return reply.code(502).send({ error: "awb_failed", message: assigned.error });
    }

    // Best-effort: a pickup can be rescheduled from the panel, and holding the
    // status hostage to it would leave a parcel with an AWB looking unbooked.
    const pickup = await server.shipping.schedulePickup(shipmentId);
    if (!pickup.ok) {
      request.log?.warn?.(
        { orderNumber: number, error: pickup.error },
        "pickup not scheduled — reschedule from the courier panel",
      );
    }

    const updated = await setOrderStatus(server, order, "processing", {
      shiprocketOrderId,
      shiprocketShipmentId: shipmentId,
      awbCode: assigned.awb,
      courierName: assigned.courier,
    });

    await audit(request, viewer, "order.status", {
      subject: number,
      detail: { to: "processing", awb: assigned.awb, courier: assigned.courier },
    });

    return {
      ok: true,
      orderNumber: number,
      status: updated.status,
      awb: assigned.awb,
      courier: assigned.courier,
      pickupScheduled: pickup.ok,
    };
  });
}
