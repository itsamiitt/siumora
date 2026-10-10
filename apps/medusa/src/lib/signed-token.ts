import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Small signed, expiring tokens (auth plan phase 4) for two hand-offs that
 * must survive a round trip through the browser without a table:
 *
 * - "google_link": a Google sign-in that is not yet tied to a customer.
 *   The storefront holds it (HTTP-only cookie) while the shopper proves
 *   their phone with an OTP; only then does the Google account link.
 * - "email_verify": the link in a verification email.
 *
 * `<base64url(json)>.<base64url(hmac-sha256)>`, with the purpose inside the
 * signed payload so one kind can never be replayed as the other. No Medusa
 * imports, so node --test can strip-type it.
 */

export type TokenPurpose = "google_link" | "email_verify";

export interface TokenPayload {
  readonly purpose: TokenPurpose;
  /** Expiry, epoch seconds. */
  readonly exp: number;
  readonly [key: string]: unknown;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function issueToken(
  purpose: TokenPurpose,
  claims: Record<string, string>,
  ttlSeconds: number,
  secret: string,
  now: Date = new Date(),
): string {
  const payload = { ...claims, purpose, exp: Math.floor(now.getTime() / 1000) + ttlSeconds };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function readToken(
  token: unknown,
  purpose: TokenPurpose,
  secret: string,
  now: Date = new Date(),
): TokenPayload | undefined {
  if (typeof token !== "string" || token.length > 2048) return undefined;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return undefined;

  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
  } catch {
    return undefined;
  }
  if (payload.purpose !== purpose) return undefined;
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= now.getTime()) return undefined;
  return payload;
}

/** The secret these tokens are signed with: its own, else the JWT secret. */
export function tokenSecret(env: Record<string, string | undefined> = process.env): string {
  return env.SIUMORA_TOKEN_SECRET ?? env.JWT_SECRET ?? "siumora-dev-token-secret";
}
