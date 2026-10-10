"use client";

import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile — the bot check in front of "Send code" (auth plan
 * phase 1). Rendered only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set; the
 * backend enforces it only when TURNSTILE_SECRET_KEY is set, so the two
 * switch on together. `interaction-only`: most shoppers never see it.
 *
 * Tokens are single-use. Bumping `resetKey` renders a fresh widget for the
 * next send.
 */

declare global {
  interface Window {
    turnstile?: {
      render(element: HTMLElement, options: Record<string, unknown>): string;
      remove(widgetId: string): void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

let scriptPromise: Promise<void> | undefined;

function loadScript(): Promise<void> {
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = undefined;
      reject(new Error("turnstile failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function Turnstile({
  onToken,
  resetKey,
  action = "send_code",
}: {
  onToken: (token: string | null) => void;
  resetKey: number;
  action?: string;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !container.current) return;
    let widgetId: string | undefined;
    let cancelled = false;
    onToken(null);
    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId = window.turnstile.render(container.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action,
          appearance: "interaction-only",
          callback: (token: string) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      })
      .catch(() => onToken(null));
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [resetKey, action, onToken]);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={container} className="mt-4" />;
}
