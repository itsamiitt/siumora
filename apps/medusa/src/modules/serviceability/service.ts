import { MedusaService } from "@medusajs/framework/utils";

import { PincodeServiceability } from "./models/pincode-serviceability";

/**
 * Generated CRUD over the serviceability table
 * (listPincodeServiceabilities etc.).
 *
 * The route read does NOT go through this service: both routes share one
 * raw-SQL lookup (lookup.ts findPincode) against the shared pg connection,
 * which works whether or not the module is registered in medusa-config.ts
 * (the config file is owned elsewhere; REGISTER.md carries the snippet).
 * This service exists so the module owns its model, its migrations, and the
 * future admin surface — the weekly RTO review's write-path (M2 ops).
 */
class ServiceabilityModuleService extends MedusaService({ PincodeServiceability }) {}

export default ServiceabilityModuleService;
