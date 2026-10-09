import { MedusaService } from "@medusajs/framework/utils";

import { SiumoraWaitlistEntry } from "./models/siumora-waitlist-entry";

class SiumoraWaitlistModuleService extends MedusaService({ SiumoraWaitlistEntry }) {}

export default SiumoraWaitlistModuleService;
