/**
 * Cloudflare Turnstile on "Send code" (auth plan phase 1) — the bot check in
 * front of the one route where every hit costs money.
 *
 * Off unless TURNSTILE_SECRET_KEY is set: development and E2E run without
 * it, and a half-configured challenge that refuses every real shopper is
 * worse than none. When on, a missing or failed token refuses the send. A
 * Cloudflare outage fails OPEN (logged): the per-IP, per-number and SMS
 * budget caps still hold behind it, and sign-in going down with a
 * third-party widget is the outcome this design exists to avoid.
 */

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileOutcome =
  | { readonly ok: true; readonly skipped: boolean }
  | { readonly ok: false; readonly reason: "missing" | "rejected" };

export async function verifyTurnstile(
  token: unknown,
  remoteIp: string | undefined,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
  onOutage: (error: unknown) => void = () => undefined,
): Promise<TurnstileOutcome> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    return { ok: false, reason: "missing" };
  }

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`siteverify HTTP ${response.status}`);
    const result = (await response.json()) as { success?: unknown };
    return result.success === true ? { ok: true, skipped: false } : { ok: false, reason: "rejected" };
  } catch (error) {
    onOutage(error);
    return { ok: true, skipped: true };
  }
}
