import * as Sentry from "@sentry/nextjs";

/**
 * Server and edge error tracking. Off unless SENTRY_DSN (or the public DSN)
 * is set, so local dev, CI and preview builds send nothing.
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
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
}

/** Errors thrown in server components, route handlers and server actions. */
export const onRequestError = Sentry.captureRequestError;
