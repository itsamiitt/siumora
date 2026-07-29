import type { Channel } from "@siumora/core";

/**
 * The one message-transport contract, shared by both runtimes (eng review 4A).
 *
 * The API imports it for the synchronous sign-in OTP; the worker imports it
 * for the notification outbox. Send logic must never fork between the two —
 * one provider client, one error taxonomy, one place a provider change lands.
 */

export type MessageSendOutcome =
  | { readonly kind: "sent"; readonly providerMessageId?: string }
  /** Worth trying again — a rate limit, a 5xx, a dropped socket. */
  | { readonly kind: "retry"; readonly error: string }
  /** Final for this channel — bad credentials, a rejected template. */
  | { readonly kind: "permanent"; readonly error: string };

export interface MessageTransport {
  /** Channels this environment actually has credentials for. */
  readonly channels: readonly Channel[];
  send(
    channel: Channel,
    recipient: string,
    body: string,
    context: { templateKey: string; dltTemplateId?: string },
  ): Promise<MessageSendOutcome>;
}

/**
 * Map an HTTP refusal onto the taxonomy. The split matters: a 429 retried is
 * a delivered message, a 401 retried is four more identical refusals.
 */
export function classifyHttp(status: number, body: string): MessageSendOutcome {
  const error = `HTTP ${status}: ${body.slice(0, 300)}`;
  if (status === 429 || status >= 500) return { kind: "retry", error };
  return { kind: "permanent", error };
}
