/**
 * Address intelligence.
 *
 * Failed contact and bad addresses are the leading causes of a parcel coming
 * back, so scoring address quality at checkout is cheaper than paying freight
 * twice. Deliberately rule-based: an LLM pass can refine the text later, but
 * the score has to be explainable to an ops person reading it in the admin.
 */

export interface AddressInput {
  readonly line1: string;
  readonly line2?: string;
  readonly landmark?: string;
  readonly city: string;
  readonly stateCode: string;
  readonly pincode: string;
}

export interface AddressQuality {
  /** 0–100. Higher is more deliverable. */
  readonly score: number;
  /** What is missing or suspect, in the words an ops person would use. */
  readonly issues: string[];
  /** Below this, a courier is likely to need a phone call to find the door. */
  readonly needsReview: boolean;
}

/**
 * A house or flat identifier — the part couriers actually need.
 *
 * Matches "12", "A-4", "Flat 3B", "#7", "302/A". Its absence is the single
 * strongest text signal that a delivery will fail.
 */
const HOUSE_NUMBER = /(?:^|\s|#)(?:no\.?\s*)?[a-z]?[-/]?\d+[a-z]?(?:[-/]\d+[a-z]?)?\b/i;

/** Words that indicate a real street or building reference. */
const STREET_HINT =
  /\b(road|rd|street|st|lane|ln|marg|nagar|colony|society|apartment|apt|flat|block|sector|phase|cross|main|galli|chowk|tower|residency|enclave|vihar|puram|layout)\b/i;

const MIN_USEFUL_LENGTH = 12;

export function scoreAddress(address: AddressInput): AddressQuality {
  const issues: string[] = [];
  let score = 100;

  const full = [address.line1, address.line2].filter(Boolean).join(" ").trim();

  if (full.length < MIN_USEFUL_LENGTH) {
    score -= 30;
    issues.push("Address is very short");
  }

  if (!HOUSE_NUMBER.test(full)) {
    score -= 30;
    issues.push("No house or flat number");
  }

  if (!STREET_HINT.test(full)) {
    score -= 15;
    issues.push("No street, building or area named");
  }

  // A landmark is how most Indian addresses are actually navigated, so its
  // presence genuinely raises the delivery rate.
  if (!address.landmark?.trim()) {
    score -= 10;
    issues.push("No landmark");
  }

  if (!address.city.trim()) {
    score -= 10;
    issues.push("No city");
  }

  // Repeated characters or a single repeated word is filler, not an address.
  if (/(.)\1{4,}/.test(full) || /^(\w+)(\s+\1)+$/i.test(full.trim())) {
    score -= 25;
    issues.push("Address looks like filler text");
  }

  const bounded = Math.max(0, Math.min(100, score));
  return { score: bounded, issues, needsReview: bounded < 60 };
}
