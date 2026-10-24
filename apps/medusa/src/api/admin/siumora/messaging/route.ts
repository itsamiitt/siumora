import { providerConfiguration } from "../../../../modules/settings/providers";
import { pgOf } from "../../../../lib/customer-signin";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { requireOperator } from "../../../../lib/operator-gate";

/** Owner-only readiness from effective provider settings. Never returns credentials. */
export const AUTHENTICATE = false;

const present = (value: string | undefined) => Boolean(value && value.trim());

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "auth:settings");
  if (!operator) return;
  const { effective: env } = await providerConfiguration(pgOf(req));

  const whatsappReady = present(env.WHATSAPP_BSP_URL) && present(env.WHATSAPP_BSP_KEY) && present(env.WHATSAPP_TEXT_TEMPLATE);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    otp: {
      whatsapp: whatsappReady && present(env.WHATSAPP_OTP_TEMPLATE),
      sms: present(env.MSG91_AUTH_KEY) && present(env.MSG91_OTP_TEMPLATE_ID),
      echo: env.OTP_ECHO === "true",
    },
    alerts: { whatsapp: whatsappReady },
    email: present(env.RESEND_API_KEY) && present(env.EMAIL_FROM),
    turnstile: present(env.TURNSTILE_SECRET_KEY),
    google: present(env.GOOGLE_CLIENT_ID) && present(env.GOOGLE_CLIENT_SECRET),
  });
}
