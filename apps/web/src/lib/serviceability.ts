import "server-only";

import { api } from "./api";

export interface Serviceability {
  readonly pincode: string;
  readonly serviceable: boolean;
  readonly estimatedDays: string;
  readonly codAvailable: boolean;
}

/**
 * Pincode serviceability.
 *
 * Answered by the API from the courier serviceability table. An unknown
 * pincode reads as not serviceable rather than optimistically available — an
 * over-promised delivery is worse than an honest no.
 */
export async function checkServiceability(
  pincode: string,
): Promise<Serviceability> {
  try {
    const row = await api().getPincode(pincode);
    return {
      pincode,
      serviceable: row.serviceable,
      estimatedDays: row.estimatedDays,
      codAvailable: row.codAvailable,
    };
  } catch {
    return { pincode, serviceable: false, estimatedDays: "—", codAvailable: false };
  }
}
