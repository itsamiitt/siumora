/**
 * POST /store/siumora/me/claim { numbers: ["SIU-00012", ...] } — the
 * customer answered "yes, these are mine". Only orders that are claimable
 * right now (guest orders on this account's phone, unowned) are taken; any
 * other number in the list is ignored rather than reported, so the route
 * cannot be used to test which order numbers exist.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { claimableIdentities } from "../../../../../lib/claimable";
import { requireSession } from "../../../../../lib/customer-guard";
import { pgOf } from "../../../../../lib/customer-signin";
import { claimRequest } from "../../../../../modules/siumora-order/account-view";
import { claimOrders, type SqlClient } from "../../../../../modules/siumora-order/ownership";

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const session = requireSession(req, res);
  if (!session) return;

  const numbers = claimRequest(req.body);
  if (!numbers) {
    res.status(400).json({ error: "invalid_request", message: "numbers: expected SIU order numbers" });
    return;
  }

  const wanted = new Set(numbers);
  const claimable = await claimableIdentities(req, session.customerId);
  const orderIds = claimable
    .filter((identity) => wanted.has(identity.order_number))
    .map((identity) => identity.order_id);

  const claimed = await claimOrders(
    pgOf(req) as unknown as SqlClient,
    orderIds,
    session.customerId,
    new Date(),
  );
  res.json({ ok: true, claimed });
}
