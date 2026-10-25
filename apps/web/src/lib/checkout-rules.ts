/**
 * The checkout form's own rules — pure, so node --test pins them (plan 16
 * Phase C). They mirror what the server enforces (Medusa's
 * checkout-rules.ts validateCheckoutAddress), word for word, so a message the
 * browser shows on blur is the same message the server would send back. The
 * server stays the authority; this only lets the shopper fix things before
 * pressing Pay.
 */

import type { CartLine } from "@siumora/core";

export type CheckoutField = "phone" | "name" | "pincode" | "stateCode" | "city" | "line1";

/** Screen order: the first field in error is the one focus moves to. */
export const FIELD_ORDER: readonly CheckoutField[] = [
  "phone",
  "pincode",
  "stateCode",
  "city",
  "name",
  "line1",
];

/** The DOM id each field renders with (kept stable for the E2E suite). */
export const FIELD_ID: Readonly<Record<CheckoutField, string>> = {
  phone: "phone",
  name: "name",
  pincode: "pincode",
  stateCode: "state",
  city: "city",
  line1: "address",
};

export interface DeliveryInput {
  readonly name: string;
  readonly pincode: string;
  readonly stateCode: string;
  readonly city: string;
  readonly line1: string;
}

export type FieldErrors = Partial<Record<CheckoutField, string>>;

export function phoneError(phone: string): string | undefined {
  return /^[6-9]\d{9}$/.test(phone) ? undefined : "Enter a 10-digit mobile number.";
}

export function deliveryErrors(input: DeliveryInput): FieldErrors {
  const errors: FieldErrors = {};
  if (!/^[1-9]\d{5}$/.test(input.pincode)) errors.pincode = "Enter a six-digit pincode.";
  if (!/^\d{2}$/.test(input.stateCode)) errors.stateCode = "Choose the state.";
  if (input.city.trim().length === 0) errors.city = "Enter the city.";
  if (input.name.trim().length === 0) errors.name = "Enter the name for delivery.";
  if (input.line1.trim().length < 5) errors.line1 = "Add your flat, house or building.";
  return errors;
}

export function firstInvalid(errors: FieldErrors): CheckoutField | undefined {
  return FIELD_ORDER.find((field) => errors[field] !== undefined);
}

/**
 * "2-3" or "4–6" days → the latest arrival date, so the promise reads as a
 * date ("Arrives by Thu, 30 Oct" — Baymard: a date, not a speed). Unknown
 * windows ("—") give nothing rather than a guess.
 */
export function arrivalBy(estimatedDays: string, now: Date): Date | undefined {
  const numbers = estimatedDays.match(/\d+/g);
  if (!numbers || numbers.length === 0) return undefined;
  const days = Math.max(...numbers.map(Number));
  if (!Number.isFinite(days) || days <= 0 || days > 30) return undefined;
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  return date;
}

export function formatArrival(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

/** The analytics item list for a bag — the SKU is the id the ad catalogs key on. */
export function analyticsItems(lines: readonly CartLine[]) {
  return lines.map((line) => ({
    item_id: line.sku || line.variantId,
    item_name: line.title,
    price: line.unitPrice / 100,
    quantity: line.quantity,
    item_variant: line.variantTitle,
    item_brand: "Siumora",
  }));
}
