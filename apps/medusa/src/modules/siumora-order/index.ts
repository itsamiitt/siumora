import { Module } from "@medusajs/framework/utils";

import SiumoraOrderModuleService from "./service";

export const SIUMORA_ORDER_MODULE = "siumoraOrder";

export default Module(SIUMORA_ORDER_MODULE, {
  service: SiumoraOrderModuleService,
});
