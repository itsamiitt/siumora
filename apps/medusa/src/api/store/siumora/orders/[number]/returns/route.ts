import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { authoriseOrder } from "../../../../../../modules/returns-ndr/access";
import { insertReturnRequest } from "../../../../../../modules/returns-ndr/data";
import {
  decideReturn,
  parseReturnBody,
  returnEnvelope,
  type OrderStatus,
  type ReturnLine,
} from "../../../../../../modules/returns-ndr/lifecycle";

/**
 * POST /store/siumora/orders/:number/returns?key=<uuid> — request a return.
 *
 * The full published policy, decided by core's evaluateReturn exactly as the
 * Fastify route decides it: delivered orders only, the 7-day window (48h for
 * transit damage), the pierced-jewellery hygiene seal rule (fault reasons
 * come back regardless of the seal), COD refunds go to UPI, and every
 * eligible request auto-approves. The one-open-per-order rule is the partial
 * unique index in this module's migration surfacing as the 409 already_open.
 *
 * The returns clock: this module's status row's updated_at IS the delivered
 * moment while status is "delivered" (delivered's only outward transition is
 * "returned"), so that is the deliveredAt fed to the window — the Fastify
 * `deliveredAt ?? placedAt` fallback maps to the order's created_at.
 *
 * Envelope: {ok, return, reversePickup} — the recorded contract's exact
 * keys; reversePickup is null until the M3 Shiprocket port books real
 * reverse pickups (see lifecycle.ts returnEnvelope for the honesty note).
 */

interface OrderItemsWire {
  items?: Array<
    | {
        variant_id: string | null;
        variant?: {
          id: string;
          product?: { metadata?: Record<string, unknown> | null } | null;
        } | null;
      }
    | null
  > | null;
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const found = await authoriseOrder(req, res);
  if (!found) return;

  const parsed = parseReturnBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "invalid_request", message: parsed.message });
    return;
  }

  // The order's lines, for the not_on_order check and the hygiene rule —
  // pierced_jewellery rides the product metadata, same as the sibling read.
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "items.*", "items.variant.id", "items.variant.product.metadata"],
    filters: { id: found.orderId },
  });
  const order = orders[0] as OrderItemsWire | undefined;
  const lines: ReturnLine[] = (order?.items ?? []).filter(Boolean).map((item) => ({
    variantId: item!.variant_id ?? item!.variant?.id ?? "",
    piercedJewellery:
      (item!.variant?.product?.metadata ?? {}).pierced_jewellery === true,
  }));

  const decision = decideReturn({
    orderStatus: found.statusRow.status as OrderStatus,
    deliveredAt:
      found.statusRow.status === "delivered"
        ? new Date(found.statusRow.updated_at)
        : new Date(found.placedAt),
    now: new Date(),
    lines,
    body: parsed.value,
    // The only orders this app can hold today came through the COD complete
    // route (same posture as the sibling read's paymentMethod). Prepaid
    // arrives with M3 Razorpay; core then routes refunds to the instrument.
    paymentMethod: "cod",
  });
  if (!decision.ok) {
    res.status(decision.code).json({ error: decision.error, message: decision.message });
    return;
  }

  const inserted = await insertReturnRequest(found.pg, {
    orderId: found.orderId,
    status: decision.insert.status,
    reason: parsed.value.reason,
    resolution: parsed.value.resolution,
    variantIds: parsed.value.variantIds,
    refundTo: decision.insert.refundTo,
    freeReturnShipping: decision.insert.freeReturnShipping,
    sealIntact: parsed.value.sealIntact ?? null,
    note: parsed.value.note ?? null,
  });
  if (inserted.kind === "already_open") {
    // The partial unique index refuses a second open return on one order,
    // which would otherwise refund the same piece twice.
    res
      .status(409)
      .json({ error: "already_open", message: "A return is already open on this order." });
    return;
  }

  res.json(returnEnvelope(inserted.row));
}
