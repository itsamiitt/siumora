"use client";

import { useEffect } from "react";

import {
  DEFAULT_CONSENT,
  consentFromChoice,
  setConsent,
  type ConsentChoice,
  type ConsentState,
} from "@siumora/analytics/client";
import { Button, MicroLabel } from "@siumora/ui";

import { CONSENT_STORAGE_KEY as STORAGE_KEY } from "@/lib/pre-paint";

/**
 * Consent banner — DPDP-aligned, driving Google Consent Mode v2.
 *
 * Consent is opt-in: nothing marketing-related fires until a choice is made,
 * which is why this component has to exist at all. Without it the analytics
 * layer is inert by design.
 *
 * "Decline" is given equal visual weight to "Accept". A banner where refusing
 * is hidden or styled as secondary is not freely given consent.
 */



const ALL: ConsentChoice = {
  analytics: true,
  ads: true,
  personalisation: true,
};
const NONE: ConsentChoice = {
  analytics: false,
  ads: false,
  personalisation: false,
};

function applyConsent(state: ConsentState, decided = true) {
  setConsent(state, { decided });

  // Mirror into the dataLayer so Google tags loaded later pick up the same
  // state rather than falling back to their own defaults.
  window.dataLayer ??= [];
  window.dataLayer.push({ event: "consent_update", ...state });

  // Tell the lazy loaders (the Meta Pixel) a decision landed — including the
  // restored one on a return visit — so they never have to poll.
  if (decided) window.dispatchEvent(new Event("siumora:consent"));
}

export function ConsentBanner() {
  useEffect(() => {
    let stored: ConsentChoice | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw) as ConsentChoice;
    } catch {
      // Corrupt or unavailable storage — ask again rather than assume consent.
    }

    // Visibility is not React's to decide — see the note on the markup below.
    // This effect only tells the analytics layer what state to be in.
    if (stored) applyConsent(consentFromChoice(stored));
    // Not an answer: events queue until the visitor chooses.
    else applyConsent(DEFAULT_CONSENT, false);
  }, []);

  function choose(choice: ConsentChoice) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    } catch {
      // Storage denied — honour the choice for this session anyway.
    }
    applyConsent(consentFromChoice(choice));
    document.documentElement.removeAttribute("data-consent");
  }

  // Always rendered, never conditionally.
  //
  // Mounting this from an effect put it on screen 2.6s into a throttled phone
  // load — late enough that it became the page's Largest Contentful Paint, and
  // late enough to slide over something a shopper had started reading.
  //
  // So visibility is CSS, driven by an attribute an inline script sets before
  // the first paint. A first-time visitor gets the banner in the initial paint;
  // a returning one never sees it at all, with no flash either way, and React
  // has nothing to hydrate that could disagree with the server.
  return (
    <div
      role="dialog"
      aria-label="Cookie choices"
      className="siumora-consent fixed inset-x-0 bottom-0 z-50 border-t border-[var(--color-rule)] bg-ground/97 backdrop-blur-sm"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <MicroLabel>Cookies</MicroLabel>
          <p className="mt-1.5 text-sm text-content-muted">
            We use cookies to understand what works on this site and to measure
            our advertising. You can say no and shop exactly the same.
          </p>
        </div>

        <div className="flex shrink-0 gap-2.5">
          <Button variant="secondary" size="sm" onClick={() => choose(NONE)}>
            Decline
          </Button>
          <Button size="sm" onClick={() => choose(ALL)}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}

