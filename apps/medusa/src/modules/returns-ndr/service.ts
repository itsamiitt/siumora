import { MedusaService } from "@medusajs/framework/utils";

import { SiumoraNdrEvent } from "./models/siumora-ndr-event";
import { SiumoraOrderStatus } from "./models/siumora-order-status";
import { SiumoraReturnRequest } from "./models/siumora-return-request";

/**
 * Generated CRUD over the returns/NDR tables (listSiumoraOrderStatuses,
 * listSiumoraReturnRequests, listSiumoraNdrEvents, …).
 *
 * The route write-paths do NOT go through this service — the lazy status
 * insert needs ON CONFLICT in a single statement and the one-open-return
 * rule is a partial unique index violation, neither of which the generated
 * CRUD can express. Those live in data.ts against the shared pg connection
 * (same disposition as siumora-order/allocate.ts); this service exists so
 * the module owns its models, its migrations, and any future admin reads.
 */
class ReturnsNdrModuleService extends MedusaService({
  SiumoraNdrEvent,
  SiumoraOrderStatus,
  SiumoraReturnRequest,
}) {}

export default ReturnsNdrModuleService;
