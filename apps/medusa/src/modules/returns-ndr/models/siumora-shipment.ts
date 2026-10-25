import { model } from "@medusajs/framework/utils";

/**
 * A courier booking for an order (plan 16 Phase F · Shiprocket).
 *
 * Written by the Shiprocket fulfillment provider as the booking moves — the
 * courier order first, then the AWB — so a booking that failed at the AWB
 * step (a wallet or serviceability hiccup) resumes from there instead of
 * creating a second courier order. The courier webhook finds an order by its
 * AWB here. One live booking per order (`order_id` unique while not deleted);
 * a cancelled booking is soft-deleted, so a fresh one can follow.
 */
export const SiumoraShipment = model.define("siumora_shipments", {
  id: model.id({ prefix: "sishp" }).primaryKey(),
  order_id: model.text().unique(),
  courier_order_id: model.text().nullable(),
  shipment_id: model.text().nullable(),
  awb: model.text().nullable(),
  courier: model.text().nullable(),
  pickup_scheduled: model.boolean().default(false),
});
