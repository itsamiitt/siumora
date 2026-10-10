import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { pgOf } from "../../../../../lib/customer-signin";
import { requireOperator } from "../../../../../lib/operator-gate";
import { authHotspots, listBlocked } from "../../../../../modules/customer-session/data";
import { HEALTH_WINDOWS, healthWindow } from "../../../../../modules/customer-session/health";

/**
 * GET /admin/siumora/auth/abuse?window=24h — who is hammering sign-in
 * (auth plan phase 3): the networks (/24) and numbers (masked, grouped by a
 * keyed hash) behind the most code requests, failures and refusals, and the
 * accounts currently blocked. Support and above (customers:read).
 *
 * What to do with it lives in settings: tighten the per-IP or per-number
 * caps, lower the SMS budget, switch Turnstile on.
 */
export const AUTHENTICATE = false;

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "customers:read");
  if (!operator) return;

  const window = healthWindow(req.query.window);
  const since = new Date(Date.now() - HEALTH_WINDOWS[window] * 3_600_000);
  const pg = pgOf(req);
  const [networks, numbers, blocked] = await Promise.all([
    authHotspots(pg, since, "ip"),
    authHotspots(pg, since, "phone"),
    listBlocked(pg),
  ]);

  res.setHeader("Cache-Control", "no-store");
  res.json({
    window,
    networks: networks.map((row) => ({ network: row.key, attempts: Number(row.count) })),
    numbers: numbers.map((row) => ({ maskedPhone: row.label, attempts: Number(row.count) })),
    blocked: blocked.map((row) => ({
      customerId: row.customer_id,
      blockedAt: row.blocked_at,
      reason: row.blocked_reason,
      by: row.blocked_by,
    })),
  });
}
