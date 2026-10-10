import { NextResponse, type NextRequest } from "next/server";

import { api } from "@/lib/api";
import { rememberNext, safeNext } from "@/lib/google-signin";

/**
 * GET /auth/google/start?next=/checkout — off to Google (auth plan phase 4).
 *
 * A plain navigation, not a form post: the CSP's form-action 'self' would
 * refuse a form that redirects to accounts.google.com. Refuses quietly back
 * to /signin when Google sign-in is off, so a stale button cannot open it.
 */
export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const signin = new URL(`/signin?next=${encodeURIComponent(next)}`, request.url);

  try {
    const methods = await api().getSignInMethods();
    if (!methods.google) return NextResponse.redirect(signin);
    const { location } = await api().googleStart();
    if (!location.startsWith("https://accounts.google.com/")) return NextResponse.redirect(signin);
    await rememberNext(next);
    return NextResponse.redirect(location);
  } catch {
    signin.searchParams.set("error", "google");
    return NextResponse.redirect(signin);
  }
}
