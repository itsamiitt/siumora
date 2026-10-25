/**
 * Module-provider entry for Razorpay — registered under the payment module's
 * `providers` in medusa-config.ts with id "razorpay", so Medusa knows it as
 * `pp_razorpay_razorpay` and its webhook lands on
 * /hooks/payment/razorpay_razorpay. See REGISTER.md.
 */

import { ModuleProvider, Modules } from "@medusajs/framework/utils";

import { RazorpayPaymentProviderService } from "./service.ts";

export default ModuleProvider(Modules.PAYMENT, {
  services: [RazorpayPaymentProviderService],
});

export { RazorpayPaymentProviderService } from "./service.ts";
export type { RazorpayProviderOptions, RazorpaySessionData } from "./service.ts";

/** The provider id sessions are created against. */
export const RAZORPAY_PROVIDER_ID = "pp_razorpay_razorpay";
