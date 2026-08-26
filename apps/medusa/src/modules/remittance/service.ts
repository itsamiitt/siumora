import { MedusaService } from "@medusajs/framework/utils";

import { SiumoraCodRemittance } from "./models/siumora-cod-remittance";

/**
 * Generated CRUD over the remittance ledger (listSiumoraCodRemittances
 * etc.). The routes do NOT go through this service: ingest and the reports
 * are raw SQL against the shared pg connection (data.ts), following the
 * settings module convention. This service exists so the module owns its
 * model and its migrations.
 */
class SiumoraRemittanceModuleService extends MedusaService({
  SiumoraCodRemittance,
}) {}

export default SiumoraRemittanceModuleService;
