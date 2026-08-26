import { MedusaService } from "@medusajs/framework/utils";

import { SiumoraAudit } from "./models/siumora-audit";

/**
 * Generated CRUD over the audit table (listSiumoraAudits etc.).
 *
 * The routes do NOT go through this service: writes and reads are raw SQL
 * against the shared pg connection (data.ts), following the settings module
 * convention. This service exists so the module owns its model and its
 * migrations.
 */
class SiumoraAuditModuleService extends MedusaService({ SiumoraAudit }) {}

export default SiumoraAuditModuleService;
