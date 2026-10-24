import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { auditAction, requireOperator } from "../../../../lib/operator-gate";
import { providerConfiguration, saveProvider } from "../../../../modules/settings/providers";
import { isProviderName } from "../../../../modules/settings/provider-fields";
import type { WriteSqlClient } from "../../../../modules/settings/write";

export const AUTHENTICATE = false;
const pg = (req: MedusaRequest) => req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as WriteSqlClient;
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (!await requireOperator(req, res, "settings:write")) return;
  const { providers, editable } = await providerConfiguration(pg(req));
  res.setHeader("Cache-Control", "no-store");
  res.json({ providers, editable });
}
export async function PATCH(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "settings:write");
  if (!operator) return;
  const body = req.body as { provider?: unknown } | undefined;
  if (!body || typeof body.provider !== "string" || !isProviderName(body.provider)) {
    res.status(400).json({ message: "Unknown provider." }); return;
  }
  try { await saveProvider(pg(req), body.provider, body); }
  catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : "Unable to save provider." }); return; }
  await auditAction(req, operator, "settings.update", { subject: `provider:${body.provider}`, detail: { credentialsChanged: true } });
  const { providers, editable } = await providerConfiguration(pg(req));
  res.setHeader("Cache-Control", "no-store");
  res.json({ providers, editable });
}
