import { providerConfiguration } from "../settings/providers.ts";

/**
 * Shiprocket credentials, resolved per use — the encrypted provider settings
 * an owner saved in the admin win, the environment is the fallback, the same
 * precedence as every other provider. Switched off in the admin reads as not
 * configured: the provider then books nothing and says so.
 */

export interface ShiprocketCredentials {
  readonly configured: boolean;
  readonly email?: string | undefined;
  readonly password?: string | undefined;
  readonly pickupLocation: string;
  readonly webhookToken?: string | undefined;
}

type Env = Record<string, string | undefined>;

export interface SettingsPg {
  raw(sql: string): Promise<{ rows: unknown[] }>;
}

function fromValues(values: Env, configured: boolean): ShiprocketCredentials {
  return {
    configured,
    email: values.SHIPROCKET_EMAIL || undefined,
    password: values.SHIPROCKET_PASSWORD || undefined,
    pickupLocation: values.SHIPROCKET_PICKUP_LOCATION || "Primary",
    webhookToken: values.SHIPROCKET_WEBHOOK_TOKEN || undefined,
  };
}

export async function shiprocketCredentials(
  pg: SettingsPg | undefined,
  env: Env = process.env,
): Promise<ShiprocketCredentials> {
  const envOnly = () => fromValues(env, Boolean(env.SHIPROCKET_EMAIL && env.SHIPROCKET_PASSWORD));
  if (!pg) return envOnly();
  try {
    const { effective, providers } = await providerConfiguration(pg, env);
    return fromValues(effective, providers.shiprocket.configured);
  } catch {
    // No settings table yet (fresh database): the environment alone decides.
    return envOnly();
  }
}
