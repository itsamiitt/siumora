import { Module } from "@medusajs/framework/utils";

import ServiceabilityModuleService from "./service";

export const SERVICEABILITY_MODULE = "serviceability";

export default Module(SERVICEABILITY_MODULE, {
  service: ServiceabilityModuleService,
});
