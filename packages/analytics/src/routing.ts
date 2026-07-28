import type { AnalyticsItem, EventName } from "./events.ts";

/**
 * Event routing and shaping.
 *
 * Split out of `events.ts` so the browser can reach it without pulling in the
 * Zod schemas. The schemas are a development guard — TypeScript already
 * enforces the payload shape at every call site — and shipping a validation
 * library to every visitor to re-check what the compiler proved costs about
 * 20 kB against a 150 kB budget.
 *
 * Moved verbatim; nothing here changed.
 */

/** GA4 event name → Meta standard event. Absent means "GA4 only". */
export const META_EVENT_MAP: Partial<Record<EventName, string>> = {
  view_item: "ViewContent",
  search: "Search",
  add_to_cart: "AddToCart",
  add_to_wishlist: "AddToWishlist",
  begin_checkout: "InitiateCheckout",
  add_payment_info: "AddPaymentInfo",
  purchase: "Purchase",
  // To Meta this *is* the purchase, just confirmed later. Without the mapping a
  // COD delivery reaches Meta as nothing at all — and COD is the majority of
  // Indian orders, so the platform would be optimising against prepaid alone.
  cod_delivered: "Purchase",
  refund: "Refund",
  sign_up: "CompleteRegistration",
};

/** Events that must never be sent from the browser. */
export const SERVER_ONLY_EVENTS: ReadonlySet<EventName> = new Set([
  "refund",
  "cod_delivered",
]);

/** Convert paise to the decimal rupee value GA4 and Meta expect. */
export function toRupees(paise: number): number {
  return Math.round(paise) / 100;
}

/** Map GA4 `items[]` to the Meta `contents[]` shape. */
export function toMetaContents(items: readonly AnalyticsItem[]) {
  return items.map((item) => ({
    id: item.item_id,
    quantity: item.quantity,
    item_price: item.price,
  }));
}
