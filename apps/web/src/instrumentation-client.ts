import * as Sentry from "@sentry/nextjs";

/**
 * Browser error tracking. NEXT_PUBLIC_SENTRY_DSN is inlined at build time;
 * unset, the SDK never initialises and nothing leaves the page. No session
 * replay: it would record checkout form fields.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    // Customer data stays out of events: request bodies carry phone numbers and
    // addresses, cookies carry sessions, and order URLs carry access keys.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
    },
  });
}

/** Navigation spans for the App Router (a no-op while Sentry is off). */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
