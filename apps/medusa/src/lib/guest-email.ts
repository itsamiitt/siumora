/**
 * The derived placeholder email (same recipe as packages/sdk/src/medusa.ts
 * guestEmail — the two must agree, since guest orders are found by it).
 *
 * Medusa requires an email on a cart and on a customer; phone sign-in and
 * guest COD checkout have none, so `<phone>@guest.siumora.in` stands in. It
 * is recognisable on purpose: every read maps it back to null, and a guest
 * order's email is how sign-in finds the orders that phone placed.
 */

export const GUEST_EMAIL_DOMAIN = "guest.siumora.in";

export function guestEmail(phone: string): string {
  return `${phone}@${GUEST_EMAIL_DOMAIN}`;
}

export function isGuestEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.endsWith(`@${GUEST_EMAIL_DOMAIN}`));
}

/** A placeholder email is not the customer's email — the card says null. */
export function realEmail(email: string | null | undefined): string | null {
  if (!email || isGuestEmail(email)) return null;
  return email;
}
