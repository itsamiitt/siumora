import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { findPincode, type SqlClient } from "../../../../../modules/serviceability/lookup";
import {
  isWellFormedPincode,
  pincodeCard,
} from "../../../../../modules/serviceability/serviceability";

/**
 * GET /store/siumora/pincodes/:pincode — the serviceability card.
 *
 * The recorded contract (apps/api/src/routes/catalog.ts GET
 * /pincodes/:pincode + apps/api/src/sdk-contract.test.ts getPincode):
 * - a MALFORMED pincode (not six digits, or a leading zero) is a 400
 *   invalid_request — rejected rather than queried with, exactly like the
 *   Fastify zod arm;
 * - a KNOWN pincode is the full seven-key card {pincode, city, stateCode,
 *   serviceable, codAvailable, estimatedDays, rtoRateBps}, cacheable for an
 *   hour (courier data changes rarely);
 * - an UNKNOWN-but-well-formed pincode is not an error — it is simply one
 *   the courier has not told us about, and it must not be reported as
 *   serviceable: {pincode, serviceable:false, codAvailable:false,
 *   estimatedDays:"—", rtoRateBps:0}, uncached (the Fastify route returns
 *   before its cache header for this arm; copied).
 *
 * The row itself lives in the serviceability module's table, seeded by
 * scripts/seed-serviceability.ts (see the module's REGISTER.md).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const pincode = req.params.pincode!;

  if (!isWellFormedPincode(pincode)) {
    // Shaped like the Fastify zod-failure 400s (app.ts setErrorHandler).
    res.status(400).json({
      error: "invalid_request",
      message: "pincode: expected a six-digit Indian pincode",
    });
    return;
  }

  const pg = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as SqlClient;
  const row = await findPincode(pg, pincode);

  if (row) {
    // Serviceability data is public and changes rarely; letting the CDN
    // hold it keeps the origin out of the path for most reads.
    res.setHeader("Cache-Control", "public, max-age=3600");
  }
  res.json(pincodeCard(pincode, row));
}
