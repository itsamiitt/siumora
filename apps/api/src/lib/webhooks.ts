import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook signature verification.
 *
 * A payment webhook decides whether an order is paid. Accepting an unsigned one
 * means anyone who learns the URL can mark any order paid, so the signature is
 * checked before the body is parsed, let alone acted on.
 */

/**
 * Compare two signatures without leaking their contents through timing.
 *
 * A plain `===` returns as soon as it finds a differing byte, and the time that
 * takes tells an attacker how much of the prefix was right. That is enough to
 * recover a signature a byte at a time.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length, so compare against a fixed-size digest of each instead.
  const leftDigest = createHmac("sha256", "cmp").update(left).digest();
  const rightDigest = createHmac("sha256", "cmp").update(right).digest();

  return timingSafeEqual(leftDigest, rightDigest);
}

/**
 * Verify a Razorpay webhook.
 *
 * Razorpay signs the raw request body with the webhook secret using
 * HMAC-SHA256. The **raw** body matters: re-serialising the parsed JSON can
 * reorder keys or change spacing, and the signature then fails on a payload
 * that was perfectly genuine.
 */
export function verifyRazorpaySignature(
  rawBody: string,
  signature: string | undefined,
  secret: string | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!secret) {
    // Refuse rather than skip. A missing secret in production would otherwise
    // silently disable the only thing authenticating the payment provider.
    return { ok: false, reason: "webhook secret is not configured" };
  }
  if (!signature) return { ok: false, reason: "missing signature header" };

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(expected, signature)
    ? { ok: true }
    : { ok: false, reason: "signature mismatch" };
}

/** Courier webhooks are signed the same way, with their own secret. */
export function verifyCourierSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string | undefined,
): { ok: true } | { ok: false; reason: string } {
  return verifyRazorpaySignature(rawBody, signature, secret);
}

/** Sign a payload — used by tests and by any outbound webhook we send. */
export function sign(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}
