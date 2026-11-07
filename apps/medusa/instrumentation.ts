import * as Sentry from "@sentry/node";
import { logger } from "@medusajs/framework/logger";

import { installMoneyAlertCapture } from "./src/lib/money-alert-capture";

/**
 * Loaded by `medusa start` / `medusa develop` before the app boots (Medusa's
 * instrumentation hook: a root `instrumentation.ts` exporting `register`).
 *
 * Error tracking is off unless SENTRY_DSN is set. When it is, unhandled errors
 * are reported and every `[money-alert]` log line is also sent to Sentry as a
 * message, so a paid-but-not-placed order pages someone instead of waiting in
 * a log file.
 */
export function register(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: 0.1,
    // Customer data stays out of events: store request bodies carry phone
    // numbers and addresses, cookies carry sessions.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
    },
  });

  installMoneyAlertCapture(
    [logger as unknown as Record<string, unknown>, console as unknown as Record<string, unknown>],
    (message, level) => {
      Sentry.captureMessage(message, { level, tags: { alert: "money" } });
    },
  );
}
