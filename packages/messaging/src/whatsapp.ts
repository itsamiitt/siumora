import { classifyHttp, type MessageSendOutcome } from "./types.ts";

/**
 * WhatsApp via a BSP (plan/06's BSP-first route; Interakt-compatible shape).
 *
 * Business-initiated WhatsApp only sends *approved templates*, never free
 * text. Rather than duplicating every core template's variable order here —
 * a list that would silently drift from the copy in `@siumora/core` — the
 * launch shape is one approved pass-through template with a single body
 * parameter that carries the fully rendered message. The OTP template is the
 * one exception: a dedicated authentication template with the code as its
 * parameter, because Meta reviews authentication templates separately.
 *
 * Swapping BSPs means reimplementing exactly this file; the transport and the
 * taxonomy do not move (eng review 4A).
 */

export interface WhatsappConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  /** The approved single-parameter pass-through template. */
  readonly textTemplate: string;
  /** The approved authentication template, one parameter: the code. */
  readonly otpTemplate?: string;
  readonly languageCode?: string;
  readonly fetch?: typeof fetch;
}

export interface WhatsappClient {
  sendTemplate(input: {
    phone: string;
    template: string;
    values: readonly string[];
  }): Promise<MessageSendOutcome>;
}

export function createWhatsappClient(config: WhatsappConfig): WhatsappClient {
  const doFetch = config.fetch ?? fetch;

  return {
    async sendTemplate(input) {
      try {
        const response = await doFetch(
          `${config.baseUrl.replace(/\/$/, "")}/v1/public/message/`,
          {
            method: "POST",
            headers: {
              authorization: `Basic ${config.apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              countryCode: "+91",
              phoneNumber: input.phone,
              type: "Template",
              template: {
                name: input.template,
                languageCode: config.languageCode ?? "en",
                bodyValues: input.values,
              },
            }),
          },
        );

        const text = await response.text();
        if (!response.ok) return classifyHttp(response.status, text);

        const parsed = JSON.parse(text) as { id?: string; result?: boolean };
        return {
          kind: "sent",
          ...(parsed.id ? { providerMessageId: parsed.id } : {}),
        };
      } catch (error) {
        // A dropped socket says nothing about the message.
        return { kind: "retry", error: String(error) };
      }
    },
  };
}
