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
 */

export interface OtpSender {
  /** Which channel this environment resolved to — surfaced in logs. */
  readonly channel: "whatsapp" | "sms";
  send(phone: string, code: string): Promise<{ ok: boolean; error?: string }>;
}

export function createOtpSender(
  env: TransportEnv,
  fetchImpl?: typeof fetch,
): OtpSender | undefined {
  const clients = buildClients(env, fetchImpl);

  if (clients.whatsapp && env.WHATSAPP_OTP_TEMPLATE) {
    const template = env.WHATSAPP_OTP_TEMPLATE;
    return {
      channel: "whatsapp",
      async send(phone, code) {
        const outcome = await clients.whatsapp!.sendTemplate({
          phone,
          template,
          values: [code],
        });
        return outcome.kind === "sent"
          ? { ok: true }
          : { ok: false, error: outcome.error };
      },
    };
  }

  if (clients.sms && env.MSG91_OTP_TEMPLATE_ID) {
    const templateId = env.MSG91_OTP_TEMPLATE_ID;
    return {
      channel: "sms",
      async send(phone, code) {
        const outcome = await clients.sms!.sendFlow({
          phone,
          templateId,
          variables: { code },
        });
        return outcome.kind === "sent"
          ? { ok: true }
          : { ok: false, error: outcome.error };
      },
    };
  }

  return undefined;
}
