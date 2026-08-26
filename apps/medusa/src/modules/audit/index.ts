import { Module } from "@medusajs/framework/utils";

import SiumoraAuditModuleService from "./service";

export const SIUMORA_AUDIT_MODULE = "siumoraAudit";

export default Module(SIUMORA_AUDIT_MODULE, {
  service: SiumoraAuditModuleService,
});
