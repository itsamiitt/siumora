import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

/**
 * The shopper's IP, as the storefront saw it.
 *
 * The storefront calls Medusa from its own server (apps/web/src/lib/api.ts is
 * server-only), so `req.ip` here is the storefront's address for every
 * shopper — and a per-IP limit keyed on it is one shared budget for the whole
 * site: one script exhausts the OTP cap for everyone. The storefront forwards
 * the client IP it read from its own edge as `x-siumora-client-ip`, signed
 * with `x-siumora-client-ip-sig` = hex HMAC-SHA256(CLIENT_IP_SECRET, ip).
 *
 * The header is believed only when the signature verifies (timing-safe):
 * anyone can reach Medusa directly and send the header, and an unsigned one
 * would let a script pick a fresh "IP" per request. Anything else — no
 * secret configured, no header, a bad signature, not an IP — falls back to
 * `req.ip`, which for a direct caller is the caller.
 *
 * Structural types, no @medusajs imports: runnable under node --test.
 */

export const CLIENT_IP_HEADER = "x-siumora-client-ip";
export const CLIENT_IP_SIG_HEADER = "x-siumora-client-ip-sig";

export interface ClientIpRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

function header(req: ClientIpRequest, name: string): string | undefined {
  const value = req.headers?.[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.length > 0 ? first.trim() : undefined;
}

export function signClientIp(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip).digest("hex");
}

/** Whether `sig` is the storefront's signature over `ip`. */
export function verifyClientIp(ip: string, sig: string, secret: string): boolean {
  const expected = Buffer.from(signClientIp(ip, secret), "utf8");
  const given = Buffer.from(sig, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * The IP to key per-origin limits, OTP caps, Turnstile and security events
 * on. `secret` defaults to CLIENT_IP_SECRET; unset (local dev without the
 * storefront wired) means the forwarded header is never trusted.
 */
export function clientIp(
  req: ClientIpRequest,
  secret: string | undefined = process.env.CLIENT_IP_SECRET,
): string | undefined {
  const fallback = req.ip ?? req.socket?.remoteAddress;
  if (!secret) return fallback;
  const forwarded = header(req, CLIENT_IP_HEADER);
  const sig = header(req, CLIENT_IP_SIG_HEADER);
  // Bounded before hashing; isIP keeps a signed-but-garbage value (a
  // storefront bug) from becoming a bucket key.
  if (!forwarded || !sig || forwarded.length > 64 || isIP(forwarded) === 0) return fallback;
  return verifyClientIp(forwarded, sig, secret) ? forwarded : fallback;
}
