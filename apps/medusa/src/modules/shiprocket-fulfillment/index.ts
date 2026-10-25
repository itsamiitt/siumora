/**
 * Module-provider entry for Shiprocket — registered under the fulfillment
 * module's `providers` in medusa-config.ts with id "shiprocket", so Medusa
 * knows it as `shiprocket_shiprocket`. See REGISTER.md.
 */

import { ModuleProvider, Modules } from "@medusajs/framework/utils";

import { ShiprocketFulfillmentProviderService } from "./service.ts";

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [ShiprocketFulfillmentProviderService],
});

export { ShiprocketFulfillmentProviderService } from "./service.ts";

/** The provider id shipping options are created against. */
export const SHIPROCKET_PROVIDER_ID = "shiprocket_shiprocket";
