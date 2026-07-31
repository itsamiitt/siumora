import { MedusaService } from "@medusajs/framework/utils";

import { SiumoraOrderIdentity } from "./models/siumora-order-identity";

/**
 * Generated CRUD over the identity table (listSiumoraOrderIdentities etc.).
 *
 * The allocation write does NOT go through this service: minting an order
 * number needs `nextval()` + ON CONFLICT in a single statement, which the
 * generated create cannot express. That lives in allocate.ts against the
 * shared pg connection; this service exists so the module owns its model,
 * its migrations, and any future admin reads.
 */
class SiumoraOrderModuleService extends MedusaService({ SiumoraOrderIdentity }) {}

export default SiumoraOrderModuleService;
