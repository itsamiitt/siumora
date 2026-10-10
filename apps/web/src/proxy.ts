import { NextResponse, type NextRequest } from "next/server";

import { AB_COOKIE, AB_COOKIE_MAX_AGE, newBucket, parseBucket } from "./lib/experiments";
import { PREVIEW_COOKIE, publicDuringLaunch, validPreviewCookie } from "./lib/launch-preview";

/**
 * Give a browser its A/B bucket on its first request (auth plan phase 4,
 * lib/experiments.ts), so every later render reads the same arm. Not
 * HTTP-only: it is a number from 0 to 99 that says nothing about anyone,
 * and analytics may read it.
 */
function withBucket(request: NextRequest, response: NextResponse): NextResponse {
  if (parseBucket(request.cookies.get(AB_COOKIE)?.value) === undefined) {
    response.cookies.set(AB_COOKIE, String(newBucket()), {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: AB_COOKIE_MAX_AGE,
    });
  }
  return response;
}

export function proxy(request: NextRequest) {
  if (process.env.SITE_PHASE !== "coming-soon") return withBucket(request, NextResponse.next());

  const path = request.nextUrl.pathname;
  if (publicDuringLaunch(path)) return NextResponse.next();

  if (validPreviewCookie(request.cookies.get(PREVIEW_COOKIE)?.value, process.env.COMING_SOON_PREVIEW_PASSWORD, process.env.COMING_SOON_PREVIEW_SECRET)) {
    return withBucket(request, NextResponse.next());
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return NextResponse.json({ message: "The store is not open yet." }, { status: 403 });
  }

  if (path === "/") {
    const response = NextResponse.rewrite(new URL("/coming-soon", request.url));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  return NextResponse.redirect(new URL("/", request.url));
}

export const config = { matcher: "/:path*" };
