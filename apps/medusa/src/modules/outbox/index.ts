import { Module } from "@medusajs/framework/utils";

import SiumoraOutboxModuleService from "./service";

/**
 * The outbox (plan 16 Phase G): customer messages and server-side
 * conversions, written by order events here and drained by apps/worker —
 * a checkout never waits on WhatsApp or Meta.
 */
export const SIUMORA_OUTBOX_MODULE = "siumoraOutbox";

export default Module(SIUMORA_OUTBOX_MODULE, {
  service: SiumoraOutboxModuleService,
});
