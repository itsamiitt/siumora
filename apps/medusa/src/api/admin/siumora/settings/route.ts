import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { auditAction, requireOperator } from "../../../../lib/operator-gate";
import { invalidateSettingsCache } from "../../../../modules/settings/cache";
import { readSettings } from "../../../../modules/settings/read";
import {
  updateSetting,
  updateSettings,
  type WriteSqlClient,
} from "../../../../modules/settings/write";

/**
 * The runtime-settings admin surface, ported from
 * apps/api/src/routes/settings.ts. Owner only (settings:write, both verbs —
 * the Fastify GET gates the same way): these values stop revenue or move
 * money exposure; they are levers, not preferences.
 *
 * PATCH takes one key ({key, value}) or a drawer's whole form
 * ({entries: [{key, value}, …]}, plan 16 B23) — the latter validated and
 * written together, all or nothing, with one audit entry naming every key.
 *
 * The PATCH invalidates the shared settings cache
 * (modules/settings/cache.ts) so this instance sees the flip immediately,
 * and writes the audit entry that records the lever and who pulled it — a
 * kill-switch flip during an incident is exactly the sort of action someone
 * reconstructs later.
 */
export const AUTHENTICATE = false;

function pg(req: MedusaRequest): WriteSqlClient {
  return req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as WriteSqlClient;
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "settings:write");
  if (!operator) return;

  res.setHeader("Cache-Control", "no-store");
  res.json({ settings: await readSettings(pg(req)) });
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "settings:write");
  if (!operator) return;

  const body = (req.body ?? {}) as { key?: unknown; value?: unknown; entries?: unknown };

  if (body.entries !== undefined) {
    const result = await updateSettings(pg(req), body.entries);
    if (!result.ok) {
      res.status(400).json({ error: "invalid_setting", message: result.error });
      return;
    }
    invalidateSettingsCache();
    await auditAction(req, operator, "settings.update", {
      subject: (result.keys ?? []).join(","),
      detail: { entries: body.entries },
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ settings: result.settings });
    return;
  }

  if (typeof body.key !== "string") {
    res.status(400).json({ error: "invalid_request", message: "key: expected a string, or entries: a list" });
    return;
  }

  const result = await updateSetting(pg(req), body.key, body.value);
  if (!result.ok) {
    res.status(400).json({ error: "invalid_setting", message: result.error });
    return;
  }

  invalidateSettingsCache();
  await auditAction(req, operator, "settings.update", {
    subject: body.key,
    detail: { value: body.value },
  });

  res.setHeader("Cache-Control", "no-store");
  res.json({ settings: result.settings });
}
