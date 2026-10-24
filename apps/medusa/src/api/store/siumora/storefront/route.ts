import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { readSettings, type SqlClient } from "../../../../modules/settings/read";

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const settings = await readSettings(req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as SqlClient);
  res.setHeader("Cache-Control", "no-store");
  res.json({ content: settings.storefrontContent });
}
