import { classifyHttp, type MessageSendOutcome } from "./types.ts";

/**
 * Email via Resend. The invoice and the order notices ride here when the
 * recipient has an address and WhatsApp could not carry the message.
 */

export interface EmailConfig {
  readonly apiKey: string;
  readonly from: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

export interface EmailClient {
  send(input: {
    to: string;
    subject: string;
    text: string;
  }): Promise<MessageSendOutcome>;
}

/**
 * Subjects per template — deliberately here, not in core: the message body is
 * channel-neutral, the subject line is an email concern.
 */
export const EMAIL_SUBJECTS: Record<string, string> = {
  order_confirmed: "Your Siumora order is confirmed",
  order_shipped: "Your Siumora order is on its way",
  order_out_for_delivery: "Your Siumora order arrives today",
  order_delivered: "Your Siumora order has arrived",
  order_ndr: "We missed you — about your Siumora delivery",
  return_approved: "Your return is on",
  refund_issued: "Your refund is on its way",
  back_in_stock: "Back in stock at Siumora",
};

export function emailSubject(templateKey: string): string {
  return EMAIL_SUBJECTS[templateKey] ?? "An update on your Siumora order";
}

export function createEmailClient(config: EmailConfig): EmailClient {
  const doFetch = config.fetch ?? fetch;
  const base = config.baseUrl ?? "https://api.resend.com";

  return {
    async send(input) {
      try {
        const response = await doFetch(`${base}/emails`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from: config.from,
            to: input.to,
            subject: input.subject,
            text: input.text,
          }),
        });

        const text = await response.text();
        if (!response.ok) return classifyHttp(response.status, text);

        const parsed = JSON.parse(text) as { id?: string };
        return {
          kind: "sent",
          ...(parsed.id ? { providerMessageId: parsed.id } : {}),
        };
      } catch (error) {
        return { kind: "retry", error: String(error) };
      }
    },
  };
}
