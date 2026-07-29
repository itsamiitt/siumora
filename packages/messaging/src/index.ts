/**
 * Provider clients and the shared message transport (eng review 4A).
 *
 * Imported by the API for the synchronous sign-in OTP and by the worker for
 * the notification outbox — one provider client, one error taxonomy, one
 * place a provider change lands. Every client takes an injectable fetch, so
 * every branch is testable before a single regulatory clock clears.
 */

export {
  classifyHttp,
  type MessageSendOutcome,
  type MessageTransport,
} from "./types.ts";
export {
  createWhatsappClient,
  type WhatsappClient,
  type WhatsappConfig,
} from "./whatsapp.ts";
export { createSmsClient, type SmsClient, type SmsConfig } from "./sms.ts";
export {
  createEmailClient,
  emailSubject,
  EMAIL_SUBJECTS,
  type EmailClient,
  type EmailConfig,
} from "./email.ts";
export {
  buildClients,
  createTransport,
  unconfiguredTransport,
  type BuiltClients,
  type TransportEnv,
} from "./transport.ts";
export { createOtpSender, type OtpSender } from "./otp.ts";
