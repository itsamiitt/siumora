import { MedusaService } from "@medusajs/framework/utils";

import { SiumoraSettings } from "./models/siumora-settings";

/**
 * Generated CRUD over the settings table (listSiumoraSettings etc.).
 *
 * The config read does NOT go through this service: it is one raw SELECT
 * plus a pure defaults-merge (read.ts + settings.ts), following the
 * siumora-order convention. This service exists so the module owns its
 * model, its migrations, and the M2 admin write path when it lands.
 */
class SiumoraSettingsModuleService extends MedusaService({ SiumoraSettings }) {}

export default SiumoraSettingsModuleService;
