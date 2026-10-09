import { Module } from "@medusajs/framework/utils";

import SiumoraWaitlistModuleService from "./service";

export const SIUMORA_WAITLIST_MODULE = "siumoraWaitlist";

export default Module(SIUMORA_WAITLIST_MODULE, { service: SiumoraWaitlistModuleService });
