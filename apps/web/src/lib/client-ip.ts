import { createHmac } from "node:crypto";

/**
 * The shopper's IP, forwarded to Medusa signed (security review, item 3).
 *
 * Every Medusa call leaves from this server, so without this Medusa's per-IP
 * limits — the OTP send cap above all — count the whole site as one shopper.
 * Medusa believes `x-siumora-client-ip` only when `x-siumora-client-ip-sig`
 * is HMAC-SHA256(CLIENT_IP_SECRET, ip) (apps/medusa/src/lib/client-ip.ts),
 * so a shopper cannot pick their own "IP" by sending the header themselves.
 *
 * The IP is the first `x-forwarded-for` hop, else `x-real-ip` — what the
 * edge in front of this server writes. Pure (no next/headers import) so it
 * runs under node --test; api.ts feeds it the request's headers.
 */

export const CLIENT_IP_HEADER = "x-siumora-client-ip";
export const CLIENT_IP_SIG_HEADER = "x-siumora-client-ip-sig";

interface HeaderReader {
  get(name: string): string | null;
}

export function clientIpFrom(headers: HeaderReader): string | undefined {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip")?.trim();
  // Bounded: an IPv6 address is at most 45 characters.
  return ip && ip.length <= 64 ? ip : undefined;
}

export function clientIpHeaders(
  headers: HeaderReader,
  secret: string | undefined,
): Record<string, string> | undefined {
  if (!secret) return undefined;
  const ip = clientIpFrom(headers);
  if (!ip) return undefined;
  return {
    [CLIENT_IP_HEADER]: ip,
    [CLIENT_IP_SIG_HEADER]: createHmac("sha256", secret).update(ip).digest("hex"),
  };
}
