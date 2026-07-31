import { Module } from "@medusajs/framework/utils";

import GstModuleService from "./service";

export const GST_MODULE = "gst";

export default Module(GST_MODULE, {
  service: GstModuleService,
});
