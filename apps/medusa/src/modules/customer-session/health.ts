/**
 * Sign-in health (auth plan phase 3) — the auth event counts turned into
 * the numbers an operator acts on. Pure, so node --test can strip-type it.
 *
 * The funnel: codes requested → delivered → verified → signed in. Where
 * it leaks says what to fix: low delivery is a provider or template
 * problem (switch the channel order, chase the BSP); low verification
 * with good delivery is a UX problem or an attack (lots of sends nobody
 * reads); a jump in rate-limit refusals is an attack in progress.
 */

export interface EventCount {
  readonly type: string;
  readonly channel: string | null;
  readonly count: number | string;
}

export interface ChannelHealth {
  readonly channel: string;
  readonly sent: number;
  readonly failed: number;
  /** sent / (sent + failed); null when nothing was attempted. */
  readonly deliveryRate: number | null;
}

export interface SignInHealth {
  readonly requested: number;
  readonly sent: number;
  readonly sendFailed: number;
  readonly verified: number;
  readonly failedCodes: number;
  readonly rateLimited: number;
  readonly challengeFailed: number;
  readonly signedIn: number;
  readonly blockedSignIns: number;
  readonly newDeviceAlerts: number;
  /** Delivered codes that ended in a verified sign-in; null with no sends. */
  readonly verifyRate: number | null;
  readonly channels: readonly ChannelHealth[];
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 1000 : null;
}

export function summariseHealth(rows: readonly EventCount[]): SignInHealth {
  const total = (type: string) =>
    rows.filter((row) => row.type === type).reduce((sum, row) => sum + Number(row.count), 0);

  const sent = total("otp_sent");
  const sendFailed = total("otp_send_failed");
  // A send with no channel configured (OTP_ECHO development) is a request.
  const requested = total("otp_requested") + sent + sendFailed;
  const verified = total("otp_verified");

  const channelNames = new Set(
    rows
      .filter((row) => (row.type === "otp_sent" || row.type === "otp_send_failed") && row.channel)
      .map((row) => row.channel as string),
  );
  const channels = [...channelNames].sort().map((channel) => {
    const of = (type: string) =>
      rows
        .filter((row) => row.type === type && row.channel === channel)
        .reduce((sum, row) => sum + Number(row.count), 0);
    const channelSent = of("otp_sent");
    const channelFailed = of("otp_send_failed");
    return {
      channel,
      sent: channelSent,
      failed: channelFailed,
      deliveryRate: rate(channelSent, channelSent + channelFailed),
    };
  });

  return {
    requested,
    sent,
    sendFailed,
    verified,
    failedCodes: total("otp_failed"),
    rateLimited: total("otp_rate_limited"),
    challengeFailed: total("turnstile_failed"),
    signedIn: total("signin_completed"),
    blockedSignIns: total("signin_blocked"),
    newDeviceAlerts: total("new_device_alert"),
    verifyRate: rate(verified, sent),
    channels,
  };
}

/** The windows the health page offers. */
export const HEALTH_WINDOWS = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 } as const;
export type HealthWindow = keyof typeof HEALTH_WINDOWS;

export function healthWindow(value: unknown): HealthWindow {
  return typeof value === "string" && value in HEALTH_WINDOWS ? (value as HealthWindow) : "24h";
}
