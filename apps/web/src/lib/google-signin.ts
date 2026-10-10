import "server-only";

import { cookies } from "next/headers";

/**
 * Google sign-in's two short-lived cookies (auth plan phase 4), both
 * HTTP-only and gone in ten minutes:
 *
 * - where to return after signing in (Google's round trip loses the page);
 * - the link token for a Google account not yet tied to a phone — held
 *   while the shopper verifies their phone, then spent by verifyCode.
 */

const NEXT_COOKIE = "siumora_signin_next";
const LINK_COOKIE = "siumora_google_link";
const STATE_COOKIE = "siumora_google_state";
const TEN_MINUTES = 600;

import { safeNext } from "./safe-next";

export { safeNext };

const shortCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: TEN_MINUTES,
};

export async function rememberNext(next: string): Promise<void> {
  (await cookies()).set(NEXT_COOKIE, safeNext(next), shortCookie);
}

export async function takeNext(): Promise<string> {
  const store = await cookies();
  const next = safeNext(store.get(NEXT_COOKIE)?.value);
  store.delete(NEXT_COOKIE);
  return next;
}

/**
 * Bind the Google round trip to THIS browser (security review: login CSRF).
 * Medusa keeps Google's `state` on the server only, so without this anyone
 * could send a victim a callback URL carrying the attacker's code and state,
 * and the victim's next phone OTP would link the attacker's Google account.
 * The start route stores the state here; the callback must present it.
 */
export async function rememberGoogleState(state: string): Promise<void> {
  (await cookies()).set(STATE_COOKIE, state, shortCookie);
}

export async function takeGoogleState(): Promise<string | undefined> {
  const store = await cookies();
  const state = store.get(STATE_COOKIE)?.value;
  store.delete(STATE_COOKIE);
  return state;
}

export async function holdGoogleLink(token: string, googleEmail?: string): Promise<void> {
  (await cookies()).set(LINK_COOKIE, JSON.stringify({ token, email: googleEmail ?? null }), shortCookie);
}

function readLink(raw: string | undefined): { token: string; email: string | null } | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { token?: unknown; email?: unknown };
    return typeof parsed.token === "string"
      ? { token: parsed.token, email: typeof parsed.email === "string" ? parsed.email : null }
      : undefined;
  } catch {
    return undefined;
  }
}

export async function pendingGoogleLink(): Promise<string | undefined> {
  return readLink((await cookies()).get(LINK_COOKIE)?.value)?.token;
}

/** The masked Google account the pending link would attach, for the notice. */
export async function pendingGoogleEmail(): Promise<string | null> {
  return readLink((await cookies()).get(LINK_COOKIE)?.value)?.email ?? null;
}

export async function clearGoogleLink(): Promise<void> {
  (await cookies()).delete(LINK_COOKIE);
}
