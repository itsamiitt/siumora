import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { authoriseOrder } from "../../../../../../modules/returns-ndr/access";
import {
  countNdrAttempts,
  insertNdrEvent,
  setStatus,
} from "../../../../../../modules/returns-ndr/data";
import {
  SIMULATION_REFUSAL,
  courierSimulationEnabled,
  decideAdvance,
  orderEnvelope,
  parseStatusBody,
  type OrderStatus,
} from "../../../../../../modules/returns-ndr/lifecycle";

/**
 * POST /store/siumora/orders/:number/status?key=<uuid> — courier-driven
 * transition. The real driver is the M3 Shiprocket webhook.
 *
 * Gated exactly as the Fastify route gates it: everyone but an operator may
 * only call this while the courier simulation is switched on, because
 * marking your own parcel delivered opens the return window and recognises
 * the revenue. The simulation env semantics mirror apps/api/src/server.ts
 * (COURIER_SIMULATION="true", or unset outside production); the operator
 * grant arrives with the M2 operator module, so until then the simulation
 * is the only path through this gate.
 *
 * Transitions are validated against core's canTransition over THIS module's
 * status row (the status truth until M3 — see data.ts on the lazy insert),
 * and an NDR that core's outcomeFor judges unrecoverable collapses straight
 * to rto, recording the attempt either way. Envelope: {ok, order}.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const found = await authoriseOrder(req, res);
  if (!found) return;

  if (!courierSimulationEnabled(process.env)) {
    res
      .status(SIMULATION_REFUSAL.code)
      .json({ error: SIMULATION_REFUSAL.error, message: SIMULATION_REFUSAL.message });
    return;
  }

  const parsed = parseStatusBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "invalid_request", message: parsed.message });
    return;
  }

  const attempts = await countNdrAttempts(found.pg, found.orderId);
  const decision = decideAdvance(
    found.statusRow.status as OrderStatus,
    parsed.value.status,
    attempts,
    parsed.value.ndrReason,
    found.statusRow.ndr_reason,
  );
  if (!decision.ok) {
    res.status(decision.code).json({ error: decision.error, message: decision.message });
    return;
  }

  const updated = await setStatus(
    found.pg,
    found.orderId,
    decision.status,
    decision.ndrReason ?? undefined,
  );
  if (decision.recordNdr) {
    await insertNdrEvent(found.pg, {
      orderId: found.orderId,
      reason: decision.ndrReason ?? "customer_unavailable",
      attempt: decision.deliveryAttempts,
    });
  }

  res.json(
    orderEnvelope(
      found.orderNumber,
      updated.status,
      decision.deliveryAttempts,
      updated.ndr_reason,
    ),
  );
}
