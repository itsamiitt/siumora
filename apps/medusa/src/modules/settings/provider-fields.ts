/** Shared with the admin UI; contains names only, never credentials. */
export const PROVIDERS = {
  razorpay: { label: "Razorpay", fields: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"] },
  whatsapp: { label: "WhatsApp", fields: ["WHATSAPP_BSP_URL", "WHATSAPP_BSP_KEY", "WHATSAPP_TEXT_TEMPLATE", "WHATSAPP_OTP_TEMPLATE"] },
  sms: { label: "MSG91 SMS", fields: ["MSG91_AUTH_KEY", "MSG91_OTP_TEMPLATE_ID"] },
  email: { label: "Resend email", fields: ["RESEND_API_KEY", "EMAIL_FROM"] },
} as const;
export type ProviderName = keyof typeof PROVIDERS;
export function isProviderName(value: string): value is ProviderName {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}
