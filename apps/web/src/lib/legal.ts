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
 *
 * Completeness comes in two tiers, because the fields arrive at two times:
 * the contact block (entity name, address, support and grievance details) has
 * no registration dependency and goes live on day one, while the GSTIN and
 * the company identifier wait on the registrar. `CONTACT_COMPLETE` gates
 * publishing the site to reviewers; `LEGAL_COMPLETE` gates opening sale.
 */

export type LegalEntityType = "private-limited" | "llp" | "proprietorship";

export interface RegistrationIdentifier {
  readonly label: "CIN" | "LLPIN";
  readonly value: string;
}

export interface LegalEntity {
  readonly registeredName: string;
  readonly address: string;
  readonly gstin: string;
  readonly supportEmail: string;
  readonly supportPhone: string;
  readonly grievanceOfficer: string;
  readonly grievanceEmail: string;
  readonly entityType: LegalEntityType;
  /** CIN for a private limited, LLPIN for an LLP, none for a proprietorship. */
  readonly registrationIdentifier: RegistrationIdentifier | null;
}

const PLACEHOLDER = "—";

export function isConfigured(value: string): boolean {
  return value !== PLACEHOLDER && value.trim().length > 0;
}

function parseEntityType(raw: string | undefined): LegalEntityType {
  // Unknown or unset falls back to the strictest form — private limited
  // requires a CIN, so a typo can only demand more disclosure, never less.
  if (raw === "llp" || raw === "proprietorship" || raw === "private-limited") {
    return raw;
  }
  return "private-limited";
}

/** Pure so the completeness tiers are testable with a synthetic environment. */
export function computeLegal(env: Record<string, string | undefined>): {
  legal: LegalEntity;
  contactComplete: boolean;
  legalComplete: boolean;
} {
  const entityType = parseEntityType(env.NEXT_PUBLIC_LEGAL_ENTITY_TYPE);

  const registrationIdentifier: RegistrationIdentifier | null =
    entityType === "private-limited"
      ? { label: "CIN", value: env.NEXT_PUBLIC_CIN ?? PLACEHOLDER }
      : entityType === "llp"
        ? { label: "LLPIN", value: env.NEXT_PUBLIC_LLPIN ?? PLACEHOLDER }
        : null;

  const legal: LegalEntity = {
    registeredName: env.NEXT_PUBLIC_LEGAL_NAME ?? PLACEHOLDER,
    address: env.NEXT_PUBLIC_LEGAL_ADDRESS ?? PLACEHOLDER,
    gstin: env.NEXT_PUBLIC_GSTIN ?? PLACEHOLDER,
    supportEmail: env.NEXT_PUBLIC_SUPPORT_EMAIL ?? PLACEHOLDER,
    supportPhone: env.NEXT_PUBLIC_SUPPORT_PHONE ?? PLACEHOLDER,
    grievanceOfficer: env.NEXT_PUBLIC_GRIEVANCE_OFFICER ?? PLACEHOLDER,
    grievanceEmail: env.NEXT_PUBLIC_GRIEVANCE_EMAIL ?? PLACEHOLDER,
    entityType,
    registrationIdentifier,
  };

  const contactComplete = [
    legal.registeredName,
    legal.address,
    legal.supportEmail,
    legal.supportPhone,
    legal.grievanceOfficer,
    legal.grievanceEmail,
  ].every(isConfigured);

  const legalComplete =
    contactComplete &&
    isConfigured(legal.gstin) &&
    (registrationIdentifier === null || isConfigured(registrationIdentifier.value));

  return { legal, contactComplete, legalComplete };
}

const computed = computeLegal(process.env);

export const LEGAL: LegalEntity = computed.legal;

/**
 * The registration-independent disclosures are all real. This is the bar for
 * putting the site in front of KYC reviewers with sale still closed.
 */
export const CONTACT_COMPLETE = computed.contactComplete;

/** True once every statutory disclosure has a real value. Gates opening sale. */
export const LEGAL_COMPLETE = computed.legalComplete;

/** Statutory service levels under the E-Commerce Rules 2020. */
export const GRIEVANCE_ACKNOWLEDGEMENT_HOURS = 48;
export const GRIEVANCE_RESOLUTION_DAYS = 30;

/** DPDP ceiling for resolving a data-principal grievance. */
export const DPDP_GRIEVANCE_DAYS = 90;

export const RETURN_WINDOW_DAYS = 7;

/** Legal Metrology requires country of origin on every listing. */
export const COUNTRY_OF_ORIGIN = "India";
