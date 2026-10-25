import { MedusaService } from "@medusajs/framework/utils";

import { SiumoraCartReminder } from "./models/siumora-cart-reminder";
import { SiumoraNotification } from "./models/siumora-notification";
import { SiumoraNotificationPreference } from "./models/siumora-notification-preference";
import { SiumoraTrackingEvent } from "./models/siumora-tracking-event";

class SiumoraOutboxModuleService extends MedusaService({
  SiumoraCartReminder,
  SiumoraNotification,
  SiumoraNotificationPreference,
  SiumoraTrackingEvent,
}) {}

export default SiumoraOutboxModuleService;
