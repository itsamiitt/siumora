/** Shared with the admin UI; contains names only, never credentials. */
export const PROVIDERS = {
  razorpay: { label: "Razorpay", fields: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"] },
  shiprocket: { label: "Shiprocket", fields: ["SHIPROCKET_EMAIL", "SHIPROCKET_PASSWORD", "SHIPROCKET_PICKUP_LOCATION", "SHIPROCKET_WEBHOOK_TOKEN"] },
  whatsapp: { label: "WhatsApp", fields: ["WHATSAPP_BSP_URL", "WHATSAPP_BSP_KEY", "WHATSAPP_TEXT_TEMPLATE", "WHATSAPP_OTP_TEMPLATE"] },
  sms: { label: "MSG91 SMS", fields: ["MSG91_AUTH_KEY", "MSG91_OTP_TEMPLATE_ID"] },
  email: { label: "Resend email", fields: ["RESEND_API_KEY", "EMAIL_FROM"] },
} as const;
export type ProviderName = keyof typeof PROVIDERS;
export function isProviderName(value: string): value is ProviderName {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}

/**
 * Fields a provider works without: the webhook secrets (the browser path
 * and the recon/poll paths still work, webhooks are refused), and the
 * Shiprocket pickup location name ("Primary" when unset).
 */
export const OPTIONAL_FIELDS: ReadonlySet<string> = new Set([
  "RAZORPAY_WEBHOOK_SECRET",
  "SHIPROCKET_PICKUP_LOCATION",
  "SHIPROCKET_WEBHOOK_TOKEN",
]);

/** Human labels for the admin — never an environment-variable name on screen. */
export const FIELD_LABELS: Readonly<Record<string, string>> = {
  RAZORPAY_KEY_ID: "Key ID",
  RAZORPAY_KEY_SECRET: "Key secret",
  RAZORPAY_WEBHOOK_SECRET: "Webhook secret",
  SHIPROCKET_EMAIL: "API user email",
  SHIPROCKET_PASSWORD: "API user password",
  SHIPROCKET_PICKUP_LOCATION: "Pickup location name",
  SHIPROCKET_WEBHOOK_TOKEN: "Webhook token",
  WHATSAPP_BSP_URL: "BSP endpoint (https)",
  WHATSAPP_BSP_KEY: "BSP API key",
  WHATSAPP_TEXT_TEMPLATE: "Text template name",
  WHATSAPP_OTP_TEMPLATE: "Sign-in code template name",
  MSG91_AUTH_KEY: "Auth key",
  MSG91_OTP_TEMPLATE_ID: "DLT code template ID",
  RESEND_API_KEY: "API key",
  EMAIL_FROM: "Sender address",
};
