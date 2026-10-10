/**
 * POST /store/siumora/me/erasure — "erase my account" (DPDP Act; flips the
 * SDK's requestErasure). Behind the StepUpGate: a stolen session must not
 * be able to delete someone's account and order history.
 *
 * Recorded first, then attempted on the spot (src/lib/erasure.ts). When an
 * order is still moving the request stays open with the reason and the
 * 30-day deadline, exactly the Fastify envelope:
 *
 *   { requestId, alreadyOpen, erased, pendingBecause?, resolveBy, retained }
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { RETENTION_NOTICE } from "@siumora/core";

import { requireStepUp } from "../../../../../lib/customer-guard";
import { pgOf } from "../../../../../lib/customer-signin";
import { eraseCustomer } from "../../../../../lib/erasure";
import { openPrivacyRequest, setPrivacyStatus } from "../../../../../modules/customer-session/privacy";

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const session = requireStepUp(req, res);
  if (!session) return;

  const pg = pgOf(req);
  const now = new Date();
  const { request, existing } = await openPrivacyRequest(pg, {
    customerId: session.customerId,
    kind: "erasure",
    now,
  });

  const result = await eraseCustomer(req.scope, session.customerId, now);
  if (result.erased) {
    await setPrivacyStatus(pg, request.id, "completed", now);
  } else if (result.reason) {
    // Left open, not refused: it becomes possible when the parcels land.
    await setPrivacyStatus(pg, request.id, "acknowledged", now, result.reason);
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({
    requestId: request.id,
    alreadyOpen: existing,
    erased: result.erased,
    ...(result.reason ? { pendingBecause: result.reason } : {}),
    resolveBy: new Date(request.resolve_by).toISOString(),
    retained: RETENTION_NOTICE,
  });
}
