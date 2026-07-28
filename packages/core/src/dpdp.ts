import type { ShippingAddress } from "./order.ts";

/**
 * Data-principal rights under the DPDP Act 2023.
 *
 * plan/11 §5 asks for access, correction and erasure. The interesting one is
 * erasure, because it collides with a law that says the opposite: GST requires
 * a seller to keep invoices and the records behind them for six years from the
 * end of the relevant financial year. A shop that honours an erasure request by
 * deleting the order has broken the tax law to satisfy the privacy law.
 *
 * So erasure here is **redaction, not deletion**. The personal data goes — the
 * name, the phone, the street, the tracking identifiers. The statutory record
 * stays: what was sold, for how much, which tax was charged and under which
 * invoice number. The distinction is the whole design, and getting it wrong in
 * either direction is a penalty.
 *
 * Nothing in here writes anything. It states the policy so the policy can be
 * tested, argued with and shown to a regulator without reading a repository.
 */

/** What a request asks for. */
export type PrivacyRequestKind = "access" | "correction" | "erasure";

export type PrivacyRequestStatus =
  /** Received, not yet acknowledged to the person who asked. */
  | "received"
  /** Acknowledged within the 48-hour window the e-commerce rules set. */
  | "acknowledged"
  /** Done. */
  | "completed"
  /**
   * Refused, with a reason. A refusal is a legitimate outcome — a request to
   * erase a live order under dispute, say — but only ever a stated one.
   */
  | "refused";

/**
 * Acknowledge within this. The Consumer Protection (E-Commerce) Rules 2020 set
 * 48 hours for a grievance; a privacy request is treated the same rather than
 * inventing a slower clock for the one with a statutory penalty attached.
 */
export const ACKNOWLEDGE_HOURS = 48;

/**
 * Resolve within this. plan/11 §5 names a 90-day ceiling; the e-commerce rules
 * name one month for grievances. The shorter promise is the one made, because a
 * shop that publishes 90 days will use 90 days.
 */
export const RESOLVE_DAYS = 30;

export interface PrivacyRequestDates {
  readonly acknowledgeBy: Date;
  readonly resolveBy: Date;
}

export function slaFor(receivedAt: Date): PrivacyRequestDates {
  return {
    acknowledgeBy: new Date(receivedAt.getTime() + ACKNOWLEDGE_HOURS * 3_600_000),
    resolveBy: new Date(receivedAt.getTime() + RESOLVE_DAYS * 86_400_000),
  };
}

/** Past its resolve date and not finished. The queue an operator must work. */
export function isOverdue(
  status: PrivacyRequestStatus,
  resolveBy: Date,
  now: Date = new Date(),
): boolean {
  if (status === "completed" || status === "refused") return false;
  return resolveBy < now;
}

/**
 * Statuses an order must be past before its personal data can go.
 *
 * A parcel in transit needs an address to be delivered to and a phone for the
 * courier to call. Erasing mid-flight does not protect anybody — it strands the
 * goods and the money both.
 */
const SETTLED_STATUSES = new Set([
  "delivered",
  "returned",
  "rto",
  "cancelled",
]);

export function isErasable(orderStatus: string): boolean {
  return SETTLED_STATUSES.has(orderStatus);
}

/** Why a request cannot be completed yet, in words a person can act on. */
export function blockedReason(orderStatuses: readonly string[]): string | null {
  const live = orderStatuses.filter((status) => !isErasable(status));
  if (live.length === 0) return null;

  return `${live.length} order${live.length === 1 ? " is" : "s are"} still in progress (${[
    ...new Set(live),
  ]
    .map((status) => status.replace(/_/g, " "))
    .join(", ")}). Personal data is erased once they settle.`;
}

/** The marker left in place of erased text, so a blank never reads as a bug. */
export const REDACTED = "[erased]";

/**
 * Redact a shipping address.
 *
 * State code survives because it is the place of supply, and the place of
 * supply is what decides whether the invoice charged IGST or CGST+SGST —
 * erasing it would make the tax on a retained invoice unverifiable.
 *
 * Pincode and city survive too, and that is a judgement rather than a
 * requirement: neither identifies a person on its own, and both are what the
 * RTO model in plan/05 learns from. Name, phone and street go, which is the
 * part that identifies anybody.
 */
export function redactAddress(address: ShippingAddress): ShippingAddress {
  return {
    ...address,
    name: REDACTED,
    phone: REDACTED,
    line1: REDACTED,
    ...(address.line2 !== undefined ? { line2: REDACTED } : {}),
    // A landmark is "opposite the Sharma house" — as identifying as the street.
    ...(address.landmark !== undefined ? { landmark: REDACTED } : {}),
  };
}

/**
 * A phone number that cannot be reversed but is still unique.
 *
 * The customer row has to stay — orders reference it, and orphaning them would
 * break the invoice trail. It just must not be a person any more. A random
 * token keeps the unique index satisfied without leaving anything that maps
 * back to a number; a hash would, because the space of Indian mobile numbers is
 * small enough to enumerate in an afternoon.
 */
export function erasedPhone(token: string): string {
  return `erased:${token}`;
}

export function isErasedPhone(phone: string): boolean {
  return phone.startsWith("erased:");
}

/**
 * What the export has to contain.
 *
 * Listed as data rather than left implicit in a query, so a new table that
 * holds personal data is a visible omission here rather than a silent one. Each
 * entry says where it lives and why it is in scope.
 */
export const EXPORT_SCOPE = [
  { table: "customers", holds: "phone, name, email, when the account was made" },
  { table: "orders", holds: "delivery address, phone, what was bought, what was paid" },
  { table: "order_lines", holds: "the items on each order" },
  { table: "return_requests", holds: "returns raised and why" },
  { table: "ndr_events", holds: "failed delivery attempts and their reasons" },
  { table: "sessions", holds: "sign-in sessions — metadata only, never the token" },
  { table: "consent_log", holds: "what was consented to, and when" },
  { table: "cod_remittances", holds: "cash collected against this person's orders" },
] as const;

/**
 * Reviews are deliberately absent from the scope above.
 *
 * They carry an author name and nothing that ties them to an account, because
 * there is no review-submission endpoint yet — every row is seed data. Listing
 * them would promise an export that matched nothing and an erasure that erased
 * nothing.
 *
 * When submission is built it must record who wrote the review, or a person who
 * publishes their name here will have no way to take it back. Stated as a
 * constant so the obligation travels with the code rather than living in a
 * commit message.
 */
export const UNATTRIBUTED_TABLES = [
  {
    table: "reviews",
    why: "no submission endpoint exists yet, so nothing links a review to an account",
    owed: "record the author when review submission is built, or the name cannot be erased",
  },
] as const;

/**
 * What is kept even after erasure, and under what law.
 *
 * Published in the export itself. A person told "your data is erased" while an
 * invoice with their order on it stays for six years has been misled, and the
 * honest answer is short enough to just give them.
 */
export const RETENTION_NOTICE = [
  {
    keeps: "Tax invoices and the order records behind them",
    forHowLong: "Six years from the end of the financial year",
    because:
      "Section 36 of the CGST Act requires a registered seller to retain them. Personal details on them are redacted; amounts, tax and invoice numbers are not.",
  },
  {
    keeps: "Aggregate figures — pincode-level delivery outcomes, revenue totals",
    forHowLong: "Indefinitely",
    because:
      "They identify nobody once the personal fields are redacted, and they are what decides whether a lane can be served cash-on-delivery at all.",
  },
] as const;
