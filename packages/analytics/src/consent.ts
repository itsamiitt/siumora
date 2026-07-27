/**
 * Consent state — Google Consent Mode v2, bridged to a DPDP banner.
 *
 * Consent is the control plane for every tag. Marketing events wait for ads
 * consent; analytics events wait for analytics consent. Order records are
 * written regardless, because performing the contract the customer entered is
 * lawful without marketing consent — and losing the order to a declined banner
 * would be absurd.
 */

export type ConsentSignal = "granted" | "denied";

export interface ConsentState {
  /** GA4 and PostHog. */
  analytics_storage: ConsentSignal;
  /** Advertising cookies. */
  ad_storage: ConsentSignal;
  /** Sending user data to ad platforms — gates CAPI identifiers. */
  ad_user_data: ConsentSignal;
  /** Personalised advertising. */
  ad_personalization: ConsentSignal;
}

/**
 * Pre-decision default: everything denied.
 *
 * Google's Consent Mode still lets tags send cookieless pings in this state, so
 * denying by default costs modelling accuracy but not lawfulness — the right
 * trade under DPDP.
 */
export const DEFAULT_CONSENT: ConsentState = {
  analytics_storage: "denied",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
};

export const FULL_CONSENT: ConsentState = {
  analytics_storage: "granted",
  ad_storage: "granted",
  ad_user_data: "granted",
  ad_personalization: "granted",
};

export interface ConsentChoice {
  analytics: boolean;
  ads: boolean;
  personalisation: boolean;
}

export function consentFromChoice(choice: ConsentChoice): ConsentState {
  const signal = (v: boolean): ConsentSignal => (v ? "granted" : "denied");
  return {
    analytics_storage: signal(choice.analytics),
    ad_storage: signal(choice.ads),
    ad_user_data: signal(choice.ads),
    ad_personalization: signal(choice.personalisation && choice.ads),
  };
}

export function analyticsAllowed(state: ConsentState): boolean {
  return state.analytics_storage === "granted";
}

export function adsAllowed(state: ConsentState): boolean {
  return state.ad_storage === "granted";
}

/**
 * Whether hashed identifiers may be attached to a server event.
 *
 * Distinct from `adsAllowed`: a user can permit ad cookies while refusing to
 * have their data sent onward, and CAPI identifiers must respect that.
 */
export function userDataAllowed(state: ConsentState): boolean {
  return state.ad_user_data === "granted";
}
