import { Module } from "@medusajs/framework/utils";

import ReturnsNdrModuleService from "./service";

export const RETURNS_NDR_MODULE = "returnsNdr";

export default Module(RETURNS_NDR_MODULE, {
  service: ReturnsNdrModuleService,
});
