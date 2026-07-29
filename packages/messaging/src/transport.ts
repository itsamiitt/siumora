import type { Channel } from "@siumora/core";

import { createEmailClient, emailSubject, type EmailClient } from "./email.ts";
import { createSmsClient, type SmsClient } from "./sms.ts";
import { createWhatsappClient, type WhatsappClient } from "./whatsapp.ts";
import type { MessageSendOutcome, MessageTransport } from "./types.ts";

/**
 * The transport the worker drains through, assembled from whatever this
 * environment holds credentials for. A channel with no credentials simply is
 * not in `channels`, and the outbox records the gap as `skipped` — the honest
 * state, never a crash.
 */

export interface TransportEnv {
  readonly WHATSAPP_BSP_URL?: string;
  readonly WHATSAPP_BSP_KEY?: string;
  readonly WHATSAPP_TEXT_TEMPLATE?: string;
  readonly WHATSAPP_OTP_TEMPLATE?: string;
  readonly MSG91_AUTH_KEY?: string;
  readonly MSG91_OTP_TEMPLATE_ID?: string;
  readonly RESEND_API_KEY?: string;
  readonly EMAIL_FROM?: string;
}

export interface BuiltClients {
  readonly whatsapp?: WhatsappClient;
  readonly sms?: SmsClient;
  readonly email?: EmailClient;
}

export function buildClients(
  env: TransportEnv,
  fetchImpl?: typeof fetch,
): BuiltClients {
  return {
    ...(env.WHATSAPP_BSP_URL && env.WHATSAPP_BSP_KEY && env.WHATSAPP_TEXT_TEMPLATE
      ? {
          whatsapp: createWhatsappClient({
            baseUrl: env.WHATSAPP_BSP_URL,
            apiKey: env.WHATSAPP_BSP_KEY,
            textTemplate: env.WHATSAPP_TEXT_TEMPLATE,
            ...(env.WHATSAPP_OTP_TEMPLATE
              ? { otpTemplate: env.WHATSAPP_OTP_TEMPLATE }
              : {}),
            ...(fetchImpl ? { fetch: fetchImpl } : {}),
          }),
        }
      : {}),
    ...(env.MSG91_AUTH_KEY
      ? {
          sms: createSmsClient({
            authKey: env.MSG91_AUTH_KEY,
            ...(env.MSG91_OTP_TEMPLATE_ID
              ? { otpTemplateId: env.MSG91_OTP_TEMPLATE_ID }
              : {}),
            ...(fetchImpl ? { fetch: fetchImpl } : {}),
          }),
        }
      : {}),
    ...(env.RESEND_API_KEY && env.EMAIL_FROM
      ? {
          email: createEmailClient({
            apiKey: env.RESEND_API_KEY,
            from: env.EMAIL_FROM,
            ...(fetchImpl ? { fetch: fetchImpl } : {}),
          }),
        }
      : {}),
  };
}

export function createTransport(
  env: TransportEnv,
  options: { textTemplate?: string; fetch?: typeof fetch } = {},
): MessageTransport {
  const clients = buildClients(env, options.fetch);
  const textTemplate = options.textTemplate ?? env.WHATSAPP_TEXT_TEMPLATE;

  const channels: Channel[] = [
    ...(clients.whatsapp && textTemplate ? (["whatsapp"] as const) : []),
    ...(clients.sms ? (["sms"] as const) : []),
    ...(clients.email ? (["email"] as const) : []),
    // push is never in the list until FCM exists; the outbox says so per row.
  ];

  return {
    channels,
    async send(channel, recipient, body, context): Promise<MessageSendOutcome> {
      if (channel === "whatsapp" && clients.whatsapp && textTemplate) {
        // One approved pass-through template, the rendered body as its single
        // parameter — see whatsapp.ts for why this is the launch shape.
        return clients.whatsapp.sendTemplate({
          phone: recipient,
          template: textTemplate,
          values: [body],
        });
      }

      if (channel === "sms" && clients.sms) {
        if (!context.dltTemplateId) {
          // No DLT id, no SMS — TRAI refuses it anyway; better a recorded
          // refusal here than a silent drop at the operator.
          return {
            kind: "permanent",
            error: `${context.templateKey} has no DLT template id`,
          };
        }
        return clients.sms.sendFlow({
          phone: recipient,
          templateId: context.dltTemplateId,
          variables: { body },
        });
      }

      if (channel === "email" && clients.email) {
        return clients.email.send({
          to: recipient,
          subject: emailSubject(context.templateKey),
          text: body,
        });
      }

      return { kind: "permanent", error: `${channel} is not configured` };
    },
  };
}

/** The transport for an environment with no messaging credentials at all. */
export function unconfiguredTransport(): MessageTransport {
  return {
    channels: [],
    async send(channel) {
      return { kind: "permanent", error: `${channel} is not configured` };
    },
  };
}
