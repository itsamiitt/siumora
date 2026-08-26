import { Module } from "@medusajs/framework/utils";

import SiumoraRemittanceModuleService from "./service";

export const SIUMORA_REMITTANCE_MODULE = "siumoraRemittance";

export default Module(SIUMORA_REMITTANCE_MODULE, {
  service: SiumoraRemittanceModuleService,
});
