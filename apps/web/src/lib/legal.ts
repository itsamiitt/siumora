/**
 * Legal entity and compliance constants.
 *
 * Several of these are statutory disclosures under the Consumer Protection
 * (E-Commerce) Rules 2020 and the DPDP Act — the registered entity name, the
 * GSTIN, and the grievance officer's name and contact must all be published.
 *
 * They are left as explicit placeholders rather than invented. A plausible-
 * looking GSTIN or a made-up grievance officer would be a false regulatory
 * disclosure, and it would look real enough that nobody would think to check.
 * `isConfigured` drives a visible notice so an unfilled value cannot ship
 * quietly.
 */

export interface LegalEntity {
  readonly registeredName: string;
  readonly address: string;
  readonly gstin: string;
  readonly cin: string;
  readonly supportEmail: string;
  readonly supportPhone: string;
  readonly grievanceOfficer: string;
  readonly grievanceEmail: string;
}

const PLACEHOLDER = "—";

export const LEGAL: LegalEntity = {
  registeredName: process.env.NEXT_PUBLIC_LEGAL_NAME ?? PLACEHOLDER,
  address: process.env.NEXT_PUBLIC_LEGAL_ADDRESS ?? PLACEHOLDER,
  gstin: process.env.NEXT_PUBLIC_GSTIN ?? PLACEHOLDER,
  cin: process.env.NEXT_PUBLIC_CIN ?? PLACEHOLDER,
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? PLACEHOLDER,
  supportPhone: process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? PLACEHOLDER,
  grievanceOfficer: process.env.NEXT_PUBLIC_GRIEVANCE_OFFICER ?? PLACEHOLDER,
  grievanceEmail: process.env.NEXT_PUBLIC_GRIEVANCE_EMAIL ?? PLACEHOLDER,
};

export function isConfigured(value: string): boolean {
  return value !== PLACEHOLDER && value.trim().length > 0;
}

/** True once every statutory disclosure has a real value. */
export const LEGAL_COMPLETE = Object.values(LEGAL).every(isConfigured);

/** Statutory service levels under the E-Commerce Rules 2020. */
export const GRIEVANCE_ACKNOWLEDGEMENT_HOURS = 48;
export const GRIEVANCE_RESOLUTION_DAYS = 30;

/** DPDP ceiling for resolving a data-principal grievance. */
export const DPDP_GRIEVANCE_DAYS = 90;

export const RETURN_WINDOW_DAYS = 7;

/** Legal Metrology requires country of origin on every listing. */
export const COUNTRY_OF_ORIGIN = "India";
