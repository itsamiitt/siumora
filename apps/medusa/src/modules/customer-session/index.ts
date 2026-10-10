import { Module } from "@medusajs/framework/utils";

import CustomerSessionModuleService from "./service";

export const CUSTOMER_SESSION_MODULE = "siumoraCustomerSession";

export default Module(CUSTOMER_SESSION_MODULE, {
  service: CustomerSessionModuleService,
});
