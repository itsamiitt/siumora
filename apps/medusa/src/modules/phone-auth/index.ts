/**
 * Module-provider entry for the `phone-otp` auth provider.
 *
 * Registered under the auth module's `providers` list in medusa-config.ts —
 * see REGISTER.md in this directory for the exact snippet (the config file
 * is owned elsewhere; this module never edits it).
 */

import { ModuleProvider, Modules } from "@medusajs/framework/utils";

import { PhoneOtpAuthService } from "./service.ts";

export default ModuleProvider(Modules.AUTH, {
  services: [PhoneOtpAuthService],
});

export { PhoneOtpAuthService } from "./service.ts";
export type {
  PhoneOtpAuthOptions,
  PhoneOtpAuthenticationResponse,
  PhoneOtpChallengeDetails,
} from "./service.ts";
