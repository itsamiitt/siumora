import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { joinWaitlist, parseSignup, type SqlClient } from "../../../../modules/waitlist/data";

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const input = parseSignup(req.body);
  if (!input) {
    res.status(400).json({ error: "invalid_request", message: "Enter a valid name and email address." });
    return;
  }
  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlClient;
  await joinWaitlist(pg, input);
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, message: "You're on the list. We'll be in touch when Siumora opens." });
}
