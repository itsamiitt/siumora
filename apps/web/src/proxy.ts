import { NextResponse, type NextRequest } from "next/server";

import { PREVIEW_COOKIE, publicDuringLaunch, validPreviewCookie } from "./lib/launch-preview";

export function proxy(request: NextRequest) {
  if (process.env.SITE_PHASE !== "coming-soon") return NextResponse.next();

  const path = request.nextUrl.pathname;
  if (publicDuringLaunch(path)) return NextResponse.next();

  if (validPreviewCookie(request.cookies.get(PREVIEW_COOKIE)?.value, process.env.COMING_SOON_PREVIEW_PASSWORD, process.env.COMING_SOON_PREVIEW_SECRET)) {
    return NextResponse.next();
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
