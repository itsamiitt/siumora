"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Last-resort boundary, for when the root layout itself fails.
 *
 * It replaces the layout, so it brings its own <html> and <body>, and its
 * styling is inline: globals.css, the fonts and the theme tokens may be
 * exactly what failed to load. The colours are the brand's ivory, ink and
 * mulberry, with the Ink Plate ground in dark mode.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    // A no-op unless NEXT_PUBLIC_SENTRY_DSN is set (instrumentation-client.ts).
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en-IN">
      <body className="siu-global-error">
        <style>{`
          .siu-global-error { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; box-sizing: border-box; background: #f7f3ea; color: #1c1917; font-family: Georgia, "Times New Roman", serif; text-align: center; }
          .siu-global-error main { max-width: 420px; }
          .siu-global-error h1 { font-weight: 300; font-size: 34px; line-height: 1.15; margin: 0; }
          .siu-global-error p { font-family: system-ui, sans-serif; font-size: 15px; line-height: 1.7; color: #57534e; margin: 16px 0 0; }
          .siu-global-error .actions { margin-top: 32px; display: flex; flex-wrap: wrap; gap: 24px; justify-content: center; align-items: center; }
          .siu-global-error button { font: 500 12px system-ui, sans-serif; letter-spacing: .12em; text-transform: uppercase; background: #6b2942; color: #f7f3ea; border: 0; height: 44px; padding: 0 24px; cursor: pointer; }
          .siu-global-error a { font: 500 11px system-ui, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: inherit; text-decoration: none; border-bottom: 1px solid currentColor; padding-bottom: 4px; }
          .siu-global-error small { display: block; margin-top: 40px; font: 12px system-ui, sans-serif; color: #a8a29e; }
          @media (prefers-color-scheme: dark) {
            .siu-global-error { background: #14110f; color: #f7f3ea; }
            .siu-global-error p { color: #c4bcb2; }
          }
        `}</style>
        <main>
          <h1>Something slipped.</h1>
          <p>
            Siumora could not load just now. It is usually a moment&apos;s
            hiccup — please try again.
          </p>
          <div className="actions">
            {/* A full reload, not reset(): the root layout is what failed,
                and only a fresh request rebuilds it. */}
            <button type="button" onClick={() => window.location.reload()}>
              Try again
            </button>
            <a href="/">Back to shop</a>
          </div>
          {error.digest && <small>Reference {error.digest}</small>}
        </main>
      </body>
    </html>
  );
}
