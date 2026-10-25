import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IInventoryService } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

import { auditAction, requireOperator } from "../../../../../../lib/operator-gate";
import {
  findIdentityByNumber,
  type SqlClient as IdentitySqlClient,
} from "../../../../../../modules/siumora-order/allocate";
import {
  claimRestock,
  getStatusRow,
  releaseRestock,
  type SqlClient,
} from "../../../../../../modules/returns-ndr/data";
import {
  decideRestock,
  restockAdjustments,
  type RestockLine,
} from "../../../../../../modules/returns-ndr/lifecycle";

/**
 * POST /admin/siumora/orders/:number/restock — the goods of an rto/returned
 * order are back in somebody's hands; put them back on the shelf (plan 16
 * B29, the Fastify /orders/:number/restock). Deliberately separate from the
 * status change: a parcel marked RTO is on a van, not on a shelf.
 *
 * Once: the restocked_at marker is claimed atomically BEFORE Medusa's
 * inventory is adjusted, so a double click cannot count the goods twice; a
 * failed adjustment releases the claim. A repeat click answers 200 with the
 * state, not an error — it is somebody checking. Audited (order.restock).
 *
 * The goods go back to the location the order was fulfilled from, else the
 * first stock location.
 */
export const AUTHENTICATE = false;

const ALREADY = { ok: false, reason: "already_restocked", message: "These goods are already back in stock." };

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "orders:write");
  if (!operator) return;

  const number = req.params.number!;
  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlClient;
  const identity = await findIdentityByNumber(pg as unknown as IdentitySqlClient, number);
  if (!identity) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const statusRow = await getStatusRow(pg, identity.order_id);
  const decision = decideRestock(statusRow?.status ?? "confirmed", statusRow?.restocked_at);
  if (!decision.ok) {
    if ("already" in decision) res.json(ALREADY);
    else res.status(decision.code).json({ ok: false, reason: "not_eligible", message: decision.message });
    return;
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "items.quantity",
      "items.variant.manage_inventory",
      "items.variant.inventory_items.inventory_item_id",
      "items.variant.inventory_items.required_quantity",
      "fulfillments.location_id",
    ],
    filters: { id: identity.order_id },
  });
  const order = orders[0] as
    | { items?: RestockLine[] | null; fulfillments?: Array<{ location_id?: string | null } | null> | null }
    | undefined;
  if (!order) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  let locationId = order.fulfillments?.find((fulfillment) => fulfillment?.location_id)?.location_id ?? undefined;
  if (!locationId) {
    const { data: locations } = await query.graph({
      entity: "stock_location",
      fields: ["id"],
      pagination: { take: 1, skip: 0 },
    });
    locationId = (locations[0] as { id: string } | undefined)?.id;
  }
  if (!locationId) {
    res.status(409).json({ ok: false, reason: "no_location", message: "No stock location to put the goods back in." });
    return;
  }

  const adjustments = restockAdjustments(order.items ?? [], locationId);

  if (!(await claimRestock(pg, identity.order_id, new Date()))) {
    // Lost a race with another click, or the order moved on meanwhile.
    res.json(ALREADY);
    return;
  }
  try {
    if (adjustments.length > 0) {
      const inventory = req.scope.resolve<IInventoryService>(Modules.INVENTORY);
      await inventory.adjustInventory(adjustments);
    }
  } catch (error) {
    await releaseRestock(pg, identity.order_id);
    res.status(502).json({
      ok: false,
      reason: "inventory_failed",
      message: `Inventory was not changed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }

  const units = adjustments.reduce((sum, adjustment) => sum + adjustment.adjustment, 0);
  await auditAction(req, operator, "order.restock", {
    subject: identity.order_number,
    detail: { units, locationId },
  });
  res.json({ ok: true, units });
}
