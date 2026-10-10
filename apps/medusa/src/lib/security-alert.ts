import type { MedusaRequest } from "@medusajs/framework/http";

// prettier-ignore -- single line so @ts-ignore reaches the specifier
// @ts-ignore -- TS1479 until @siumora/messaging ships require-condition types
import { createTransport, type TransportEnv } from "@siumora/messaging";

/**
 * Security messages to the account holder on WhatsApp (auth plan phase 2):
 * a sign-in from a device the account has not used before, and a change of
 * the account's phone number (sent to the OLD number — the one that can
 * still raise the alarm).
 *
 * Fire-and-forget with a short bound: the sign-in has happened, and a slow
 * BSP must not hold the response. Nothing is sent where no WhatsApp text
 * template is configured.
 */

const IST = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export const SECURITY_URL = "siumora.in/account/security";

export function newDeviceMessage(device: string, at: Date): string {
  return (
    `Siumora: your account was just signed in on ${device} (${IST.format(at)} IST). ` +
    `Not you? Sign out every device at ${SECURITY_URL}.`
  );
}

export function phoneChangedMessage(maskedNewPhone: string, at: Date): string {
  return (
    `Siumora: the phone number on your account was changed to ${maskedNewPhone} ` +
    `(${IST.format(at)} IST). Not you? Reply to this message or write to our grievance desk.`
  );
}

export function sendSecurityAlert(
  req: MedusaRequest,
  phone: string,
  body: string,
  templateKey: "security_new_device" | "security_phone_changed",
): Promise<boolean> {
  const transport = createTransport(process.env as TransportEnv);
  if (!transport.channels.includes("whatsapp")) return Promise.resolve(false);

  const logger = req.scope.resolve("logger") as { warn(message: string): void };
  const send = transport
    .send("whatsapp", phone, body, { templateKey })
    .then((outcome: { kind: string; error?: string }) => {
      if (outcome.kind !== "sent") logger.warn(`${templateKey} not sent: ${outcome.error ?? outcome.kind}`);
      return outcome.kind === "sent";
    })
    .catch((error: unknown) => {
      logger.warn(`${templateKey} not sent: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    });
  const bound = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000));
  return Promise.race([send, bound]);
}
