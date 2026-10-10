import { NextResponse, type NextRequest } from "next/server";

import { api } from "@/lib/api";
import { linkCartToAccount } from "@/lib/cart-store";
import { holdGoogleLink, takeGoogleState, takeNext } from "@/lib/google-signin";
import { startSession } from "@/lib/session";
import { linkWishlistToAccount } from "@/lib/wishlist-store";

/**
 * GET /auth/google/callback — back from Google (auth plan phase 4).
 *
 * Google sends the shopper here with a one-time code; Medusa turns it into
 * a session, or — when this Google account is not yet tied to a phone —
 * into a 10-minute link token. Then the shopper verifies their phone with
 * an OTP on /signin, and only that links the Google account. A Google
 * account never signs in to someone else's account by matching an email.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const next = await takeNext();
  const expectedState = await takeGoogleState();
  const signin = (extra: Record<string, string>) => {
    const url = new URL("/signin", request.url);
    url.searchParams.set("next", next);
    for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
    return NextResponse.redirect(url);
  };

  // Cancelled at Google, a forged hit, or a round trip this browser did not
  // start (login CSRF — the state must match the one /start stored here).
  if (!code || !state || params.get("error") || !expectedState || state !== expectedState) {
    return signin({ error: "google" });
  }

  try {
    const outcome = await api().googleFinish({ code, state });
    if (outcome.needsPhone) {
      await holdGoogleLink(outcome.linkToken, outcome.googleEmail);
      return signin({ link: "google" });
    }

    await startSession(outcome.token, outcome.expiresAt, { rolling: !outcome.isAdmin });
    const signedIn = api().withToken(outcome.token);
    await Promise.allSettled([linkCartToAccount(signedIn), linkWishlistToAccount(signedIn)]);
    return NextResponse.redirect(new URL(next, request.nextUrl.origin));
  } catch {
    return signin({ error: "google" });
  }
}
