import type { ConsentState } from "@siumora/analytics/client";

/**
 * When the Meta Pixel base script may load (eng review 8A).
 *
 * Two gates, both required: the visitor granted ads consent, and the main
 * thread has gone idle or the visitor has interacted — third-party tag JS is
 * the largest new threat to the INP/LCP budget on low-end Android, and
 * nothing about a pixel is worth paying for during first paint.
 */
export function shouldLoadPixel(consent: ConsentState): boolean {
  return consent.ad_storage === "granted";
}

export const PIXEL_SCRIPT_URL = "https://connect.facebook.net/en_US/fbevents.js";

/** The standard queue stub, so nothing tracked before the script loads is lost. */
export function installPixelStub(): void {
  if (window.fbq) return;
  const queue: unknown[][] = [];
  window.fbq = Object.assign(
    (...args: unknown[]) => {
      queue.push(args);
    },
    { queue, loaded: false, version: "2.0" },
  );
}

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

/** Resolves at first idle or first interaction, whichever the visitor gives. */
export function afterIdleOrInteraction(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      for (const event of INTERACTIONS) {
        window.removeEventListener(event, done);
      }
      resolve();
    };
    for (const event of INTERACTIONS) {
      window.addEventListener(event, done, { once: true, passive: true });
    }
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(() => done(), { timeout: 5_000 });
    } else {
      setTimeout(done, 3_000);
    }
  });
}

const INTERACTIONS = ["pointerdown", "keydown", "scroll"] as const;
