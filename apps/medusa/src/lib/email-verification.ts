/**
 * Email verification (auth plan phase 4) — the pure parts.
 *
 * The account is the phone; an email is optional, for receipts. A typed
 * email is just a claim until its owner clicks the link we send to it.
 * "Verified" is recorded as WHICH address was verified, so changing the
 * email quietly makes it unverified again instead of carrying a stale tick.
 */

export const VERIFIED_EMAIL_KEY = "siumora_verified_email";
export const VERIFIED_AT_KEY = "siumora_email_verified_at";
export const EMAIL_TOKEN_TTL_SECONDS = 24 * 60 * 60;

export function emailVerified(
  email: string | null | undefined,
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  if (!email) return false;
  const verified = metadata?.[VERIFIED_EMAIL_KEY];
  return typeof verified === "string" && verified.toLowerCase() === email.toLowerCase();
}

export function verificationLink(storefrontUrl: string, token: string): string {
  return `${storefrontUrl.replace(/\/+$/, "")}/account/verify-email?token=${encodeURIComponent(token)}`;
}

export function verificationMessage(link: string): string {
  return [
    "Confirm this email address for your Siumora account by opening the link below.",
    "",
    link,
    "",
    "It works for 24 hours. If you did not add this address to a Siumora account, ignore this email — nothing changes.",
  ].join("\n");
}
