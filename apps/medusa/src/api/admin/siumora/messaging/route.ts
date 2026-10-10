import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { requireOperator } from "../../../../lib/operator-gate";

/**
 * GET /admin/siumora/messaging — which sign-in channels this server can
 * actually send on (auth plan phase 3, settings → Messaging). Owner only
 * (auth:settings).
 *
 * Presence only, never a value: a key, a template id or a URL here would be
 * a credential on a screen. Credentials are server environment
 * (/etc/siumora/medusa.env), changed by redeploying — deliberately not a
 * text box an admin session could rewrite.
 */
export const AUTHENTICATE = false;

const present = (value: string | undefined) => Boolean(value && value.trim());

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "auth:settings");
  if (!operator) return;
  const env = process.env;

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
