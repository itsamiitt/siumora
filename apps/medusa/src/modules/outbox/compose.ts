/**
 * What an order event means for the customer and for the ad platforms —
 * pure, so node --test pins it (plan 16 Phase G). The Medusa port of the
 * Fastify queueOrderMessage / queueOrderConversion decisions
 * (apps/api/src/lib/messaging.ts, conversions.ts), over the same core
 * templates, so a customer gets the same words whichever backend served
 * them.
 */

// prettier-ignore -- single line so @ts-ignore reaches the specifier
// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { NDR_REASON_LABELS, printRupees, templateForStatus, type NdrReason } from "@siumora/core";

/** What the message decision needs to know about an order, at its new status. */
export interface OrderFacts {
  readonly id: string;
  readonly number: string;
  readonly status: string;
  readonly name: string;
  readonly phone: string | undefined;
  readonly totalPaise: number;
  readonly customerId?: string | null;
  readonly courier?: string | null;
  readonly awb?: string | null;
  readonly ndrReason?: string | null;
}

export interface MessageIntent {
  readonly eventKey: string;
  readonly templateKey: string;
  readonly recipient: string;
  readonly variables: Record<string, string | number>;
  /** Null for a message about a cart, not an order (plan 16 B22). */
  readonly orderId: string | null;
  readonly customerId?: string;
  /**
   * Consent for THIS message, given with it — the cart-reminder opt-in. A
   * stored opt-out still wins; this only stands in for the general
   * marketing-consent preference the person may never have set.
   */
  readonly consented?: boolean;
}

/**
 * The message an order should get at this status, if any. The event key is
 * order + status: a replayed courier webhook or a double-clicked move
 * produces one message, because the pair is exactly what "this happened to
 * this order" means.
 */
export function messageFor(order: OrderFacts): MessageIntent | undefined {
  const templateKey = templateForStatus(order.status);
  if (!templateKey || !order.phone) return undefined;

  // First name only: "Hi Asha Menon" reads like a bank.
  const base = { name: order.name.trim().split(/\s+/)[0] || "there", orderNumber: order.number };
  let variables: Record<string, string | number>;
  switch (templateKey) {
    case "order_confirmed":
      variables = { ...base, total: `INR ${printRupees(order.totalPaise)}` };
      break;
    case "order_shipped":
      // The real courier and AWB once booked; honest placeholders otherwise —
      // the renderer refuses an empty variable, so this never sends "with  ".
      variables = { ...base, courier: order.courier || "our courier partner", trackingId: order.awb || order.number };
      break;
    case "delivery_failed":
      variables = {
        ...base,
        reason: order.ndrReason
          ? (NDR_REASON_LABELS[order.ndrReason as NdrReason] ?? "we could not reach you")
          : "we could not reach you",
      };
      break;
    default:
      variables = base;
  }

  return {
    eventKey: `${order.id}:${order.status}`,
    templateKey,
    recipient: order.phone,
    variables,
    orderId: order.id,
    ...(order.customerId ? { customerId: order.customerId } : {}),
  };
}

/**
 * The conversion an order produces at this status, if any. Prepaid counts
 * when it is confirmed (the money is in); COD counts only when delivered —
 * a COD order that is never collected is not revenue, and reporting it as
 * a purchase trains the ad platforms on parcels that come back.
 */
export function conversionEventFor(paymentMethod: string, status: string): "purchase" | "cod_delivered" | undefined {
  if (paymentMethod === "cod") return status === "delivered" ? "cod_delivered" : undefined;
  return status === "confirmed" ? "purchase" : undefined;
}

export interface ConversionLine {
  readonly sku: string;
  readonly title: string;
  readonly variantTitle: string;
  readonly unitPricePaise: number;
  readonly quantity: number;
}

const rupees = (paise: number) => Math.round(paise) / 100;

/** The purchase payload both destinations are built from (GA4 e-commerce shape). */
export function purchasePayload(input: {
  eventId: string;
  orderNumber: string;
  totalPaise: number;
  taxPaise: number;
  shippingPaise: number;
  lines: readonly ConversionLine[];
}) {
  return {
    event_id: input.eventId,
    currency: "INR" as const,
    value: rupees(input.totalPaise),
    transaction_id: input.orderNumber,
    tax: rupees(input.taxPaise),
    shipping: rupees(input.shippingPaise),
    items: input.lines.map((line) => ({
      item_id: line.sku,
      item_name: line.title,
      price: rupees(line.unitPricePaise),
      quantity: line.quantity,
      item_variant: line.variantTitle,
      item_brand: "Siumora",
    })),
  };
}

// ── Cart reminders (plan 16 B22) ─────────────────────────────────────────

/** How long after consent a reminder is still worth sending. */
export const REMINDER_WINDOW_MS = 3 * 24 * 3_600_000;

export interface ReminderCart {
  readonly completedAt: unknown;
  readonly updatedAt: string | Date;
  readonly items: ReadonlyArray<{ readonly title: string; readonly quantity: number }>;
}

export type ReminderDecision =
  | { readonly kind: "send"; readonly items: string }
  | { readonly kind: "wait" }
  | { readonly kind: "skip"; readonly reason: string };

/**
 * Is this opted-in cart due its one reminder? Not while the shopper is
 * still at it (touched within the delay), never once it was checked out or
 * emptied, and not at all once the moment has passed (three days) — a
 * reminder a week later is noise.
 */
export function reminderDecision(
  cart: ReminderCart | undefined,
  input: { consentedAt: Date; now: Date; delayMinutes: number },
): ReminderDecision {
  if (!cart) return { kind: "skip", reason: "cart gone" };
  if (cart.completedAt) return { kind: "skip", reason: "checked out" };
  const pieces = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  if (pieces === 0) return { kind: "skip", reason: "bag emptied" };
  if (input.now.getTime() - input.consentedAt.getTime() > REMINDER_WINDOW_MS) {
    return { kind: "skip", reason: "too late to remind" };
  }
  const quietSince = input.now.getTime() - new Date(cart.updatedAt).getTime();
  if (quietSince < input.delayMinutes * 60_000) return { kind: "wait" };
  return { kind: "send", items: itemsPhrase(cart.items) };
}

/** "Petal Studs", "Petal Studs and 1 more piece", "3 pieces". */
export function itemsPhrase(items: ReadonlyArray<{ readonly title: string; readonly quantity: number }>): string {
  const pieces = items.reduce((sum, item) => sum + item.quantity, 0);
  const first = items.find((item) => item.quantity > 0 && item.title.trim().length > 0);
  if (!first) return `${pieces} ${pieces === 1 ? "piece" : "pieces"}`;
  const rest = pieces - first.quantity;
  const lead = first.quantity > 1 ? `${first.quantity} × ${first.title.trim()}` : first.title.trim();
  return rest === 0 ? lead : `${lead} and ${rest} more ${rest === 1 ? "piece" : "pieces"}`;
}

/**
 * Whose phone may a cart reminder go to (security review, item 7)? Only a
 * number the cart itself vouches for: the signed-in account's own phone
 * (verified by the OTP that made the account, and not editable through
 * Medusa's profile route) or the delivery phone checkout put on the cart.
 * The opt-in body alone is not enough — the route takes a phone and a cart
 * id from anyone, and the message is a paid WhatsApp to a stranger.
 * Numbers compare normalised (10 digits).
 */
export function reminderRecipientAllowed(
  phone: string,
  cart: { cartPhone?: string | undefined; accountPhone?: string | undefined },
): boolean {
  return phone === cart.cartPhone || phone === cart.accountPhone;
}

/** One cart reminder per phone per day, however many carts name it. */
export const REMINDER_PHONE_COOLDOWN_MS = 24 * 3_600_000;
