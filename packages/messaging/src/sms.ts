import { classifyHttp, type MessageSendOutcome } from "./types.ts";

/**
 * SMS via MSG91's flow API, under TRAI DLT.
 *
 * Every production SMS in India must cite a DLT-registered template id; the
 * core notification templates each carry theirs (`dltTemplateId`), and the
 * registered text is a single-variable pass-through carrying the rendered
 * body — the same launch shape as WhatsApp, for the same no-drift reason.
 * The OTP flow has its own DLT template, registered as an OTP category.
 */

export interface SmsConfig {
  readonly authKey: string;
  /** The DLT flow id for the OTP message. */
  readonly otpTemplateId?: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

export interface SmsClient {
  sendFlow(input: {
    phone: string;
    templateId: string;
    variables: Record<string, string>;
  }): Promise<MessageSendOutcome>;
}

export function createSmsClient(config: SmsConfig): SmsClient {
  const doFetch = config.fetch ?? fetch;
  const base = config.baseUrl ?? "https://control.msg91.com/api/v5";

  return {
    async sendFlow(input) {
      try {
        const response = await doFetch(`${base}/flow/`, {
          method: "POST",
          headers: {
            authkey: config.authKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            template_id: input.templateId,
            short_url: "0",
            recipients: [{ mobiles: `91${input.phone}`, ...input.variables }],
          }),
        });

        const text = await response.text();
        if (!response.ok) return classifyHttp(response.status, text);

        const parsed = JSON.parse(text) as {
          type?: string;
          message?: string;
        };
        if (parsed.type && parsed.type !== "success") {
          // MSG91 reports some refusals inside a 200 — an unregistered
          // template will be exactly as unregistered on the retry.
          return { kind: "permanent", error: parsed.message ?? "refused" };
        }
        return {
          kind: "sent",
          ...(parsed.message ? { providerMessageId: parsed.message } : {}),
        };
      } catch (error) {
        return { kind: "retry", error: String(error) };
      }
    },
  };
}
