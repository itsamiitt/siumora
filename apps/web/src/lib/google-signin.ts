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
const TEN_MINUTES = 600;

/** Only a same-site path is followed — never an open redirect. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
    ? next
    : "/account";
}

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

export async function holdGoogleLink(token: string): Promise<void> {
  (await cookies()).set(LINK_COOKIE, token, shortCookie);
}

export async function pendingGoogleLink(): Promise<string | undefined> {
  return (await cookies()).get(LINK_COOKIE)?.value;
}

export async function clearGoogleLink(): Promise<void> {
  (await cookies()).delete(LINK_COOKIE);
}
