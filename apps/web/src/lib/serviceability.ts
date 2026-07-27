import { isValidPincode } from "@siumora/in-locale";

export interface Serviceability {
  readonly pincode: string;
  readonly serviceable: boolean;
  /** Estimated delivery window in days. */
  readonly estimatedDays: string;
  /**
   * Whether COD is offered here. Gated by the RTO engine in production — a
   * high-risk pincode is prepaid-only even when the courier serves it.
   */
  readonly codAvailable: boolean;
}

/**
 * Serviceability lookup.
 *
 * Phase 1 answers from the pincode prefix so the UX can be built and reviewed.
 * In production this calls the courier aggregator through apps/api, which also
 * applies COD/RTO gating (see plan/05-orders-logistics.md).
 */
export async function checkServiceability(
  pincode: string,
): Promise<Serviceability> {
  if (!isValidPincode(pincode)) {
    return {
      pincode,
      serviceable: false,
      estimatedDays: "—",
      codAvailable: false,
    };
  }

  // Metro prefixes get the faster window; everything else is the standard one.
  const metroPrefixes = ["40", "11", "56", "60", "70", "50", "38", "41"];
  const isMetro = metroPrefixes.some((prefix) => pincode.startsWith(prefix));

  return {
    pincode,
    serviceable: true,
    estimatedDays: isMetro ? "2–3" : "4–6",
    codAvailable: isMetro,
  };
}
