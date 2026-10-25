import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { eraseCustomer } from "../../../../../lib/erasure";
import { auditAction, requireOperator } from "../../../../../lib/operator-gate";
import type { SqlClient } from "../../../../../modules/customer-session/data";
import {
  getPrivacyRequest,
  parsePrivacyAction,
  setPrivacyStatus,
} from "../../../../../modules/customer-session/privacy";

/**
 * POST /admin/siumora/privacy-requests/:id — answer an open request (plan 16
 * B27). Body: {action: "complete"} or {action: "refuse", note}.
 *
 * Completing an erasure runs the same check as the customer path rather
 * than trusting the operator: an override that erases a live order's
 * address strands a parcel. Still blocked → 409 with the reason, the request
 * stays open with it. Both outcomes are audited — an erasure is the one
 * irreversible action in the system, and a record of who ran it is the
 * difference between an erasure and a disappearance.
 */
export const AUTHENTICATE = false;

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "privacy:write");
  if (!operator) return;

  const parsed = parsePrivacyAction(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "invalid_request", message: parsed.message });
    return;
  }

  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlClient;
  const request = await getPrivacyRequest(pg, req.params.id!);
  if (!request || (request.status !== "received" && request.status !== "acknowledged")) {
    res.status(404).json({ error: "not_found", message: "No open request with that id." });
    return;
  }
  const now = new Date();

  if (parsed.value.action === "refuse") {
    await setPrivacyStatus(pg, request.id, "refused", now, parsed.value.note);
    await auditAction(req, operator, "privacy.refuse", {
      subject: request.id,
      detail: { kind: request.kind, note: parsed.value.note },
    });
    res.json({ ok: true, status: "refused" });
    return;
  }

  if (request.kind !== "erasure") {
    res.status(409).json({
      error: "not_erasure",
      // The storefront opens only erasures on this stack; access and
      // correction are answered from the account page itself.
      message: "Only erasure requests complete from here.",
    });
    return;
  }

  const result = await eraseCustomer(req.scope, request.customer_id, now);
  if (!result.erased) {
    await setPrivacyStatus(pg, request.id, "acknowledged", now, result.reason);
    res.status(409).json({ error: "not_yet", message: result.reason ?? "Not possible yet." });
    return;
  }

  await setPrivacyStatus(pg, request.id, "completed", now);
  await auditAction(req, operator, "privacy.erase", { subject: request.id });
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, status: "completed" });
}
