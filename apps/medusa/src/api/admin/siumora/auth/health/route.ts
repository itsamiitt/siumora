import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { pgOf } from "../../../../../lib/customer-signin";
import { requireOperator } from "../../../../../lib/operator-gate";
import { countAuthEvents } from "../../../../../modules/customer-session/data";
import { HEALTH_WINDOWS, healthWindow, summariseHealth } from "../../../../../modules/customer-session/health";

/**
 * GET /admin/siumora/auth/health?window=24h|7d|30d — the sign-in funnel
 * (auth plan phase 3): codes requested, delivered per channel, verified,
 * signed in, and the refusals beside them. Anyone on the ops dashboard
 * (metrics:read) — these are counts, nobody's details.
 */
export const AUTHENTICATE = false;

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "metrics:read");
  if (!operator) return;

  const window = healthWindow(req.query.window);
  const since = new Date(Date.now() - HEALTH_WINDOWS[window] * 3_600_000);
  const rows = await countAuthEvents(pgOf(req), since);

  res.setHeader("Cache-Control", "no-store");
  res.json({ window, since: since.toISOString(), health: summariseHealth(rows) });
}
