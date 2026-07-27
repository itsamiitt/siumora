"use client";

import { useEffect, useState } from "react";

import {
  DEFAULT_CONSENT,
  consentFromChoice,
  type ConsentChoice,
  type ConsentState,
} from "@siumora/analytics";
import { setConsent } from "@siumora/analytics/client";
import { Button, MicroLabel } from "@siumora/ui";

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

const STORAGE_KEY = "siumora.consent";

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
}

export function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let stored: ConsentChoice | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw) as ConsentChoice;
    } catch {
      // Corrupt or unavailable storage — ask again rather than assume consent.
    }

    if (stored) {
      applyConsent(consentFromChoice(stored));
    } else {
      // Not an answer — events queue until the visitor chooses.
      applyConsent(DEFAULT_CONSENT, false);
      setVisible(true);
    }
  }, []);

  function choose(choice: ConsentChoice) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    } catch {
      // Storage denied — honour the choice for this session anyway.
    }
    applyConsent(consentFromChoice(choice));
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie choices"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--color-rule)] bg-ivory/97 backdrop-blur-sm"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <MicroLabel>Cookies</MicroLabel>
          <p className="mt-1.5 text-sm text-ink-muted">
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
