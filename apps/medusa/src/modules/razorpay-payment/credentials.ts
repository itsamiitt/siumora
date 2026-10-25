import { providerConfiguration } from "../settings/providers.ts";

/**
 * Razorpay credentials, resolved per use: the encrypted provider settings an
 * owner saved in the admin win, the environment is the fallback — the same
 * precedence every other provider uses (modules/settings/providers.ts). A
 * provider switched off in the admin reads as not configured, which is what
 * turns prepaid off across the storefront without a deploy.
 */

export interface RazorpayCredentials {
  readonly configured: boolean;
  readonly keyId?: string | undefined;
  readonly keySecret?: string | undefined;
  readonly webhookSecret?: string | undefined;
}

type Env = Record<string, string | undefined>;

/** The knex slice providerConfiguration reads through. */
export interface SettingsPg {
  raw(sql: string): Promise<{ rows: unknown[] }>;
}

function fromEnv(env: Env): RazorpayCredentials {
  const keyId = env.RAZORPAY_KEY_ID || undefined;
  const keySecret = env.RAZORPAY_KEY_SECRET || undefined;
  return {
    configured: Boolean(keyId && keySecret),
    keyId,
    keySecret,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || undefined,
  };
}

export async function razorpayCredentials(
  pg: SettingsPg | undefined,
  env: Env = process.env,
): Promise<RazorpayCredentials> {
  if (!pg) return fromEnv(env);
  try {
    const { effective, providers } = await providerConfiguration(pg, env);
    return {
      configured: providers.razorpay.configured,
      keyId: effective.RAZORPAY_KEY_ID || undefined,
      keySecret: effective.RAZORPAY_KEY_SECRET || undefined,
      webhookSecret: effective.RAZORPAY_WEBHOOK_SECRET || undefined,
    };
  } catch {
    // No settings table yet (fresh database): the environment alone decides.
    return fromEnv(env);
  }
}
