import { z } from "zod";

/**
 * The event catalog — one contract feeding GA4, Meta and PostHog.
 *
 * Product code calls `track()` with one of these; it never touches `gtag` or
 * `fbq`. Destinations are adapters, so a tag change cannot drift from what the
 * product actually does.
 *
 * Prices are **rupees as decimals**, not paise. This is the one boundary where
 * that conversion happens: GA4 and Meta both expect a decimal currency value,
 * and sending paise would report every order as 100x its real value.
 */

export const CURRENCY = "INR" as const;

/**
 * Item payload. `item_id` is the SKU and must match the Merchant Center and
 * Meta catalog feeds exactly — a mismatch silently breaks Advantage+ catalog
 * ads, which fail by serving nothing rather than by erroring.
 */
export const analyticsItemSchema = z.object({
  item_id: z.string().min(1),
  item_name: z.string().min(1),
  /** GST-inclusive unit price in rupees. */
  price: z.number().nonnegative(),
  quantity: z.number().int().positive(),
  item_category: z.string().optional(),
  item_variant: z.string().optional(),
  item_brand: z.string().default("Siumora"),
});

export type AnalyticsItem = z.infer<typeof analyticsItemSchema>;

const base = z.object({
  /** Shared dedup id. Same value on the browser and server send. */
  event_id: z.string().min(1),
});

const withItems = base.extend({
  items: z.array(analyticsItemSchema).min(1),
  /** Order-level total in rupees, GST-inclusive. */
  value: z.number().nonnegative(),
  currency: z.literal(CURRENCY).default(CURRENCY),
});

export const viewItemSchema = withItems;
export const viewItemListSchema = base.extend({
  item_list_id: z.string(),
  item_list_name: z.string(),
  items: z.array(analyticsItemSchema),
});
export const selectItemSchema = withItems;
export const searchSchema = base.extend({ search_term: z.string() });
export const addToCartSchema = withItems;
export const removeFromCartSchema = withItems;
export const viewCartSchema = withItems;
export const addToWishlistSchema = withItems;
export const beginCheckoutSchema = withItems;
export const addShippingInfoSchema = withItems.extend({
  shipping_tier: z.string(),
});
export const addPaymentInfoSchema = withItems.extend({
  payment_type: z.enum(["upi", "card", "netbanking", "wallet", "cod"]),
});

export const purchaseSchema = withItems.extend({
  /** The order number shown to the customer. */
  transaction_id: z.string().min(1),
  /** Tax contained in `value`, in rupees — from the GST engine. */
  tax: z.number().nonnegative(),
  shipping: z.number().nonnegative(),
  coupon: z.string().optional(),
});

export const refundSchema = purchaseSchema;

export const signUpSchema = base.extend({
  method: z.enum(["otp", "truecaller"]),
});

/**
 * COD delivered — the truth event for finance.
 *
 * Emitted server-side only, when the courier confirms delivery. Order-placed
 * `purchase` fires for COD too (Pattern A), so platforms learn fast; this event
 * is what the RTO-adjusted revenue reporting actually trusts.
 */
export const codDeliveredSchema = purchaseSchema;

/**
 * Field Core Web Vitals (eng review 8A / W2).
 *
 * The launch gate carries numeric LCP/INP/CLS budgets; without field data the
 * criterion is unmeasurable — Lighthouse CI does not exist and lab numbers on
 * a dev machine say nothing about a low-end Android on 4G. `event_id` is the
 * metric's own id, unique per page load per metric.
 */
export const webVitalsSchema = base.extend({
  metric_name: z.enum(["LCP", "INP", "CLS", "FCP", "TTFB"]),
  /** Milliseconds, except CLS which is unitless — as web-vitals reports it. */
  value: z.number(),
  rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
  navigation_type: z.string().optional(),
});

export const EVENT_SCHEMAS = {
  view_item: viewItemSchema,
  view_item_list: viewItemListSchema,
  select_item: selectItemSchema,
  search: searchSchema,
  add_to_cart: addToCartSchema,
  remove_from_cart: removeFromCartSchema,
  view_cart: viewCartSchema,
  add_to_wishlist: addToWishlistSchema,
  begin_checkout: beginCheckoutSchema,
  add_shipping_info: addShippingInfoSchema,
  add_payment_info: addPaymentInfoSchema,
  purchase: purchaseSchema,
  refund: refundSchema,
  sign_up: signUpSchema,
  cod_delivered: codDeliveredSchema,
  web_vitals: webVitalsSchema,
} as const;

export type EventName = keyof typeof EVENT_SCHEMAS;
export type EventPayload<N extends EventName> = z.infer<
  (typeof EVENT_SCHEMAS)[N]
>;

export {
  META_EVENT_MAP,
  SERVER_ONLY_EVENTS,
  toMetaContents,
  toRupees,
} from "./routing.ts";
