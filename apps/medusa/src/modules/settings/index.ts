import { Module } from "@medusajs/framework/utils";

import SiumoraSettingsModuleService from "./service";

export const SIUMORA_SETTINGS_MODULE = "siumoraSettings";

export default Module(SIUMORA_SETTINGS_MODULE, {
  service: SiumoraSettingsModuleService,
});
