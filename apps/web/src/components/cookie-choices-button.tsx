"use client";

import { CONSENT_OPEN_EVENT } from "@/lib/pre-paint";

/** A permanent route back to the consent choice after the first visit. */
export function CookieChoicesButton() {
  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.setAttribute("data-consent", "ask");
        window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
      }}
      className="text-xs text-ivory/75 underline-offset-4 hover:text-brass-light hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ivory"
    >
      Cookie choices
    </button>
  );
}
