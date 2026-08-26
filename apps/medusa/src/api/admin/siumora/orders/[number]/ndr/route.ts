import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { auditAction, requireOperator } from "../../../../../../lib/operator-gate";
import {
  findIdentityByNumber,
  type SqlClient as IdentitySqlClient,
} from "../../../../../../modules/siumora-order/allocate";
import {
  countNdrAttempts,
  ensureStatusRow,
  recordNdrAction,
  setStatus,
  type SqlClient,
} from "../../../../../../modules/returns-ndr/data";
import {
  decideNdrAnswer,
  initialSiumoraStatus,
  orderEnvelope,
  parseNdrBody,
} from "../../../../../../modules/returns-ndr/lifecycle";

/**
 * POST /admin/siumora/orders/:number/ndr — the operator working the NDR
 * queue records the customer's answer (the phone call's outcome): reattempt,
 * update_address, or cancel. Same decisions as the customer's own store
 * route (decideNdrAnswer — only "ndr" answers, recoverability judged by
 * core), no access key needed, gated on orders:write, audited
 * (order.status: an accepted answer IS a transition).
 */
export const AUTHENTICATE = false;

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "orders:write");
  if (!operator) return;

  const number = req.params.number!;
  const pg = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as SqlClient;

  const identity = await findIdentityByNumber(
    pg as unknown as IdentitySqlClient,
    number,
  );
  if (!identity) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "status"],
    filters: { id: identity.order_id },
  });
  const order = orders[0] as { status: string } | undefined;
  if (!order) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const parsed = parseNdrBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "invalid_request", message: parsed.message });
    return;
  }

  const statusRow = await ensureStatusRow(
    pg,
    identity.order_id,
    initialSiumoraStatus(order.status),
  );

  const attempts = await countNdrAttempts(pg, identity.order_id);
  const decision = decideNdrAnswer(
    statusRow.status,
    parsed.value.action,
    attempts,
    statusRow.ndr_reason,
  );
  if (!decision.ok) {
    res.status(decision.code).json({ error: decision.error, message: decision.message });
    return;
  }

  await recordNdrAction(pg, identity.order_id, parsed.value.action);
  const updated = await setStatus(pg, identity.order_id, decision.target);

  await auditAction(req, operator, "order.status", {
    subject: identity.order_number,
    detail: { ndrAction: parsed.value.action, to: updated.status },
  });

  res.json(
    orderEnvelope(identity.order_number, updated.status, attempts, updated.ndr_reason),
  );
}
