import { buildClients, type TransportEnv } from "./transport.ts";

/**
 * The sign-in OTP, sent synchronously in the request (never the outbox — the
 * worker polls every fifteen seconds and nobody waits fifteen seconds at a
 * sign-in form).
 *
 * Channel resolution is ordered, not hardcoded (eng review): WhatsApp when
 * its authentication template is approved, else DLT SMS — sign-in unblocks at
 * whichever regulatory clock clears first. Email is deliberately not a
 * fallback: the identity being verified IS the phone number, and a code
 * delivered to an inbox proves nothing about the phone (design doc, W1).
 *
 * With both channels configured the sender fails over (auth plan phase 1):
 * WhatsApp's authentication template first — cheaper, and read faster in
 * India — then DLT SMS when WhatsApp is refused, errors or times out. A
 * customer who asks for SMS ("didn't get it?") gets SMS first and WhatsApp
 * as the fallback. Each attempt is bounded so a hung provider cannot hold
 * the sign-in form.
 */

export type OtpChannel = "whatsapp" | "sms";

export interface OtpSendOptions {
  /** Try this channel first (the storefront's "Send by SMS instead"). */
  readonly prefer?: OtpChannel;
  /**
   * False once the day's SMS budget is spent: WhatsApp still sends, SMS
   * neither leads nor catches the fallback.
   */
  readonly allowSms?: boolean;
}

export interface OtpSendResult {
  readonly ok: boolean;
  /** The channel that delivered, or the last one tried. */
  readonly channel?: OtpChannel;
  /** True when the first channel failed and the other one delivered. */
  readonly fellBack?: boolean;
  readonly error?: string;
}

export interface OtpSender {
  /** The first channel this environment resolved to — surfaced in logs. */
  readonly channel: OtpChannel;
  /** Every channel with credentials and an approved template, in order. */
  readonly channels: readonly OtpChannel[];
  send(phone: string, code: string, options?: OtpSendOptions): Promise<OtpSendResult>;
}

type ChannelSend = (phone: string, code: string) => Promise<{ ok: boolean; error?: string }>;

export function createOtpSender(
  env: TransportEnv,
  fetchImpl?: typeof fetch,
  options: { attemptTimeoutMs?: number } = {},
): OtpSender | undefined {
  const clients = buildClients(env, fetchImpl);
  const attemptTimeoutMs = options.attemptTimeoutMs ?? 8_000;
  const senders = new Map<OtpChannel, ChannelSend>();

  if (clients.whatsapp && env.WHATSAPP_OTP_TEMPLATE) {
    const template = env.WHATSAPP_OTP_TEMPLATE;
    senders.set("whatsapp", async (phone, code) => {
      const outcome = await clients.whatsapp!.sendTemplate({ phone, template, values: [code] });
      return outcome.kind === "sent" ? { ok: true } : { ok: false, error: outcome.error };
    });
  }

  if (clients.sms && env.MSG91_OTP_TEMPLATE_ID) {
    const templateId = env.MSG91_OTP_TEMPLATE_ID;
    senders.set("sms", async (phone, code) => {
      const outcome = await clients.sms!.sendFlow({ phone, templateId, variables: { code } });
      return outcome.kind === "sent" ? { ok: true } : { ok: false, error: outcome.error };
    });
  }

  const channels = [...senders.keys()];
  const first = channels[0];
  if (!first) return undefined;

  async function attempt(
    channel: OtpChannel,
    phone: string,
    code: string,
  ): Promise<{ ok: boolean; error?: string }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ ok: false; error: string }>((resolve) => {
      timer = setTimeout(
        () => resolve({ ok: false, error: `timed out after ${attemptTimeoutMs}ms` }),
        attemptTimeoutMs,
      );
    });
    try {
      return await Promise.race([
        senders.get(channel)!(phone, code).catch((error: unknown) => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    channel: first,
    channels,
    async send(phone, code, sendOptions = {}) {
      const allowSms = sendOptions.allowSms !== false;
      const prefer = sendOptions.prefer;
      const order = channels
        .filter((channel) => allowSms || channel !== "sms")
        .sort((a, b) => (prefer ? Number(b === prefer) - Number(a === prefer) : 0));
      if (order.length === 0) {
        return { ok: false, error: "no channel allowed: SMS budget spent and no WhatsApp" };
      }

      const errors: string[] = [];
      for (const [index, channel] of order.entries()) {
        const outcome = await attempt(channel, phone, code);
        if (outcome.ok) return index > 0 ? { ok: true, channel, fellBack: true } : { ok: true, channel };
        errors.push(`${channel}: ${outcome.error ?? "failed"}`);
      }
      return { ok: false, channel: order[order.length - 1]!, error: errors.join("; ") };
    },
  };
}
