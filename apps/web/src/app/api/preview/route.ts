import { NextResponse, type NextRequest } from "next/server";

import {
  PREVIEW_COOKIE, PREVIEW_TTL_SECONDS, issuePreviewCookie,
  passwordMatches, previewPasswordIsConfigured, previewSecretIsConfigured,
} from "@/lib/launch-preview";

const attempts = new Map<string, { count: number; until: number }>();
const WINDOW_MS = 15 * 60 * 1000;
// Also limit across addresses so changing a forwarded IP cannot enumerate the PIN.
let totalAttempts = { count: 0, until: 0 };

export async function POST(request: NextRequest) {
  if (process.env.SITE_PHASE !== "coming-soon") {
    return NextResponse.json({ message: "Preview is unavailable." }, { status: 404 });
  }

  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let sameOrigin = false;
  try { sameOrigin = Boolean(origin && host && new URL(origin).host === host); } catch { /* Invalid origin. */ }
  if (!sameOrigin) {
    return NextResponse.json({ message: "Invalid request origin." }, { status: 403 });
  }

  const password = process.env.COMING_SOON_PREVIEW_PASSWORD;
  const secret = process.env.COMING_SOON_PREVIEW_SECRET;
  if (!previewPasswordIsConfigured(password) || !previewSecretIsConfigured(secret)) {
    return NextResponse.json({ message: "Store preview is not configured yet." }, { status: 503 });
  }

  let supplied: unknown;
  try {
    supplied = (await request.json() as { password?: unknown }).password;
  } catch {
    supplied = undefined;
  }

  // Read and update counters after the asynchronous body read. Keeping this
  // section synchronous means parallel requests cannot reuse a stale count.
  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  if (totalAttempts.until <= now) totalAttempts = { count: 0, until: now + WINDOW_MS };
  const attempt = attempts.get(ip);
  if ((attempt && attempt.until > now && attempt.count >= 5) || totalAttempts.count >= 30) {
    const until = totalAttempts.count >= 30 ? totalAttempts.until : attempt!.until;
    return NextResponse.json({ message: "Too many attempts. Try again in 15 minutes." }, {
      status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((until - now) / 1000))), "Cache-Control": "no-store" },
    });
  }

  if (!previewPasswordIsConfigured(supplied) || !passwordMatches(supplied, password)) {
    totalAttempts.count += 1;
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const current = attempt && attempt.until > now ? attempt : { count: 0, until: now + WINDOW_MS };
    attempts.set(ip, { count: current.count + 1, until: current.until });
    return NextResponse.json({ message: "That PIN isn’t right. Please try again." }, { status: 401 });
  }

  attempts.delete(ip);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(PREVIEW_COOKIE, issuePreviewCookie(password, secret, now), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PREVIEW_TTL_SECONDS,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
