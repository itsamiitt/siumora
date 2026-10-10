import { MedusaService } from "@medusajs/framework/utils";

import { SiumoraAuthEvent } from "./models/siumora-auth-event";
import { SiumoraCustomerSecurity } from "./models/siumora-customer-security";
import { SiumoraCustomerSession } from "./models/siumora-customer-session";
import { SiumoraPrivacyRequest } from "./models/siumora-privacy-request";

/**
 * Generated CRUD over the session tables. Routes and the session middleware
 * do NOT go through it — they run raw SQL (data.ts) on the shared pg
 * connection, the audit module convention. This service exists so the
 * module owns its models and migrations.
 */
class CustomerSessionModuleService extends MedusaService({
  SiumoraCustomerSession,
  SiumoraCustomerSecurity,
  SiumoraAuthEvent,
  SiumoraPrivacyRequest,
}) {}

export default CustomerSessionModuleService;
