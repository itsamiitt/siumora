/**
 * The checkout's money and eligibility rules — pure, so node --test can
 * strip-type them (same convention as cod-gate.ts; the routes stay I/O).
 *
 * Plan 16 v3 Phase A. The quote and the completion route both decide from
 * these functions, so what the shopper was quoted and what the order is
 * charged cannot drift apart by re-implementation:
 *
 * - B1/B2: completion re-derives serviceability and COD eligibility from the
 *   cart as submitted — a quote the client skipped or edited counts for
 *   nothing (parity rows "derives the COD fee server-side", "withholds COD
 *   where the courier does not carry it", "the kill-switch pauses checkout").
 * - B3: the COD fee is charged by folding it into the cart's shipping method
 *   just before completion, with the split kept in the method's data so the
 *   order card and the invoice can print shipping and COD charges apart.
 * - B5: the delivery address is validated on the server, field by field.
 * - B8: the quote returns the totals the order will carry, per method.
 */

// prettier-ignore -- single line so @ts-ignore reaches the specifier
// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { calculateTotals, isInterState, normalisePhone, shippingFor, type CartLine, type CodDecision } from "@siumora/core";
import { createHash } from "node:crypto";

// ── Payment method ─────────────────────────────────────────────────────────

export type CheckoutPaymentMethod = "upi" | "card" | "netbanking" | "cod";

const PAYMENT_METHODS: ReadonlySet<string> = new Set(["upi", "card", "netbanking", "cod"]);

/** What Checkout.js hands the success handler — the browser's claim of payment. */
export interface PaymentProof {
  readonly orderId: string;
  readonly paymentId: string;
  readonly signature: string;
}

/**
 * The complete route's body. `paymentMethod` is optional because the COD
 * transport predates it and sends `{}` — an absent method is COD, the only
 * method that route has ever completed. A prepaid completion carries the
 * Checkout.js proof under `razorpay`.
 */
export function parseCompleteBody(
  body: unknown,
):
  | { ok: true; value: { paymentMethod: CheckoutPaymentMethod; proof?: PaymentProof } }
  | { ok: false; message: string } {
  const record =
    body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const method = record.paymentMethod ?? "cod";
  if (typeof method !== "string" || !PAYMENT_METHODS.has(method)) {
    return { ok: false, message: "paymentMethod: expected upi, card, netbanking or cod" };
  }
  if (method === "cod") return { ok: true, value: { paymentMethod: "cod" } };

  const proof = (record.razorpay ?? {}) as Record<string, unknown>;
  const field = (name: string) =>
    typeof proof[name] === "string" && (proof[name] as string).length > 0 && (proof[name] as string).length <= 255
      ? (proof[name] as string)
      : undefined;
  const orderId = field("orderId");
  const paymentId = field("paymentId");
  const signature = field("signature");
  if (!orderId || !paymentId || !signature) {
    return { ok: false, message: "razorpay: expected orderId, paymentId and signature" };
  }
  return {
    ok: true,
    value: {
      paymentMethod: method as CheckoutPaymentMethod,
      proof: { orderId, paymentId, signature },
    },
  };
}

/**
 * The method the order was paid with, recorded on the cart's metadata —
 * which Medusa copies to the order — so the order card and the invoice can
 * say "UPI" rather than assume COD.
 */
export const PAYMENT_METHOD_KEY = "siumora_payment_method";

export function paymentMethodOf(
  metadata: Record<string, unknown> | null | undefined,
): CheckoutPaymentMethod {
  const value = metadata?.[PAYMENT_METHOD_KEY];
  return typeof value === "string" && PAYMENT_METHODS.has(value)
    ? (value as CheckoutPaymentMethod)
    : "cod";
}

// ── Refusals ───────────────────────────────────────────────────────────────

export interface CheckoutRefusal {
  readonly status: 400 | 409 | 503;
  readonly body: {
    readonly error: string;
    readonly message: string;
    /** Field-keyed problems, for an address the server will not ship to. */
    readonly fields?: Readonly<Partial<Record<AddressField, string>>>;
  };
}

/**
 * The kill-switch refusal — the same words as the Fastify /checkout, so a
 * paused store reads the same whichever backend answers.
 */
export const PAYMENTS_PAUSED: CheckoutRefusal = {
  status: 503,
  body: {
    error: "payments_paused",
    message: "Checkout is paused right now. Nothing was charged.",
  },
};

/**
 * Whether this cart may complete with this method, and the COD fee it
 * carries if so. Ordered so the shopper hears the most fixable problem:
 * the method first, then where the parcel is going, then COD's own terms.
 */
export function decideCompletion(input: {
  paymentMethod: CheckoutPaymentMethod;
  serviceable: boolean;
  cod: CodDecision;
  /** Razorpay is connected (credentials present and switched on). */
  prepaidAvailable: boolean;
}): { ok: true; codFee: number } | { ok: false; refusal: CheckoutRefusal } {
  if (input.paymentMethod !== "cod" && !input.prepaidAvailable) {
    // Refused before anything is written, never recorded as an unpayable
    // order — the state of a box whose Razorpay is not connected.
    return {
      ok: false,
      refusal: {
        status: 409,
        body: {
          error: "prepaid_unavailable",
          message: "Online payment is not available yet. Choose cash on delivery.",
        },
      },
    };
  }
  if (!input.serviceable) {
    return {
      ok: false,
      refusal: {
        status: 409,
        body: { error: "not_serviceable", message: "We don't deliver to this pincode yet." },
      },
    };
  }
  if (input.paymentMethod !== "cod") return { ok: true, codFee: 0 };
  if (!input.cod.available) {
    return {
      ok: false,
      refusal: {
        status: 409,
        body: {
          error: "cod_unavailable",
          message: input.cod.reason ?? "Cash on delivery is not available.",
        },
      },
    };
  }
  return { ok: true, codFee: input.cod.fee };
}

// ── Address ────────────────────────────────────────────────────────────────

export type AddressField = "name" | "phone" | "line1" | "city" | "stateCode" | "pincode" | "giftMessage";

/** The slice of Medusa's cart shipping address the rules read. */
export interface AddressWire {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  address_1?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
}

const PINCODE_RE = /^[1-9]\d{5}$/;
const STATE_CODE_RE = /^\d{2}$/;

const filled = (value: string | null | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Everything a courier and a tax invoice need, checked where the client
 * cannot skip it. The words match the storefront's field labels so the
 * message can sit under the field it is about.
 */
export function validateCheckoutAddress(
  address: AddressWire | null | undefined,
): { ok: true } | { ok: false; refusal: CheckoutRefusal } {
  const fields: Partial<Record<AddressField, string>> = {};
  const a = address ?? {};

  if (!filled(a.first_name) && !filled(a.last_name)) fields.name = "Enter the name for delivery.";
  if (!normalisePhone(a.phone ?? "")) fields.phone = "Enter a 10-digit mobile number.";
  if (!filled(a.address_1) || a.address_1!.trim().length < 5) {
    fields.line1 = "Add your flat, house or building.";
  }
  if (!filled(a.city)) fields.city = "Enter the city.";
  if (!STATE_CODE_RE.test(a.province ?? "")) fields.stateCode = "Choose the state.";
  if (!PINCODE_RE.test(a.postal_code ?? "")) fields.pincode = "Enter a six-digit pincode.";

  if (Object.keys(fields).length === 0) return { ok: true };
  return {
    ok: false,
    refusal: {
      status: 400,
      body: {
        error: "invalid_address",
        message: Object.values(fields)[0]!,
        fields,
      },
    },
  };
}

// ── COD fee on the shipping method ─────────────────────────────────────────

/** Keys in the shipping method's data that record the split. */
export const SHIPPING_BASE_KEY = "siumora_shipping_paise";
export const COD_FEE_KEY = "siumora_cod_fee_paise";
/** The amount the last fold set — how a later repricing is recognised. */
export const FOLDED_AMOUNT_KEY = "siumora_folded_paise";

const paiseIn = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;

/**
 * The shipping method's amount and data with the COD fee folded in.
 *
 * Idempotent: the base shipping charge is remembered on first fold, so a
 * retried completion (or a later switch back to prepaid, fee 0) re-derives
 * from the base rather than stacking a second fee on the first. If Medusa
 * has repriced the method since (the bag changed and crossed the free-
 * shipping line), its amount no longer matches the one the fold set, and
 * the new amount is the base.
 */
export function foldCodFee(
  method: { amountPaise: number; data?: Record<string, unknown> | null },
  feePaise: number,
): { amountPaise: number; data: Record<string, unknown> } {
  const data = method.data ?? {};
  const remembered = paiseIn(data[SHIPPING_BASE_KEY]);
  const untouched = paiseIn(data[FOLDED_AMOUNT_KEY]) === method.amountPaise;
  const base = remembered !== undefined && untouched ? remembered : method.amountPaise;
  const amountPaise = base + feePaise;
  return {
    amountPaise,
    data: {
      ...data,
      [SHIPPING_BASE_KEY]: base,
      [COD_FEE_KEY]: feePaise,
      [FOLDED_AMOUNT_KEY]: amountPaise,
    },
  };
}

/** The COD fee an order's shipping methods carry (zero before Phase A). */
export function codFeeOf(
  methods: ReadonlyArray<{ data?: Record<string, unknown> | null } | null> | null | undefined,
): number {
  return (methods ?? []).reduce(
    (sum, method) => sum + (paiseIn(method?.data?.[COD_FEE_KEY]) ?? 0),
    0,
  );
}

/** Integer paise → Medusa major units. Exact for whole paise. */
export function paiseToMajor(paise: number): number {
  if (!Number.isInteger(paise)) throw new Error(`${paise} is not whole paise`);
  return paise / 100;
}

// ── Quote totals ───────────────────────────────────────────────────────────

export interface QuotedTotals {
  readonly subtotal: number;
  /** Coupon paise off the lines (plan 16 B19); zero without one. */
  readonly discount: number;
  readonly shipping: number;
  readonly codFee: number;
  readonly total: number;
  readonly gst: {
    readonly taxableValue: number;
    readonly cgst: number;
    readonly sgst: number;
    readonly igst: number;
  };
}

/**
 * What the order will carry, per method, in integer paise.
 *
 * Shipping is core's shippingFor, which the seeded Standard Delivery option
 * mirrors by construction (₹79 under ₹999, free at and above). Until the
 * delivery state is known the supply is quoted intra-state, the same
 * assumption the bag makes; `interState` says which one was used.
 *
 * A coupon (plan 16 B19) arrives as each line's `discount`, read off
 * Medusa's own adjustments. The free-shipping threshold is judged on the
 * value AFTER the coupon — Medusa's item_total, which the seeded price
 * rules read, is net of adjustments.
 */
export function quoteTotals(
  lines: readonly CartLine[],
  input: { stateCode?: string | undefined; cod: CodDecision },
): { prepaid: QuotedTotals; cod: QuotedTotals | null; interState: boolean } {
  const interState = input.stateCode ? isInterState(input.stateCode) : false;
  const netGoods = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity - (line.discount ?? 0), 0);
  const shipping = shippingFor(netGoods);

  const shape = (codFee: number): QuotedTotals => {
    const totals = calculateTotals(lines, { interState, shipping, codFee });
    return {
      subtotal: totals.subtotal,
      discount: totals.discount,
      shipping: totals.shipping,
      codFee: totals.codFee,
      total: totals.total,
      gst: {
        taxableValue: totals.gst.taxableValue,
        cgst: totals.gst.cgst,
        sgst: totals.gst.sgst,
        igst: totals.gst.igst,
      },
    };
  };

  return {
    prepaid: shape(0),
    cod: input.cod.available ? shape(input.cod.fee) : null,
    interState,
  };
}

/**
 * A short fingerprint of what is in the bag and at what price. The
 * storefront compares it between quotes to say "prices updated" instead of
 * letting a changed total slip past the shopper.
 */
export function cartVersion(
  lines: ReadonlyArray<{ variantId: string; quantity: number; unitPrice: number }>,
): string {
  const canonical = lines
    .map((line) => `${line.variantId}:${line.quantity}:${line.unitPrice}`)
    .sort()
    .join("|");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

// ── Coupons (plan 16 B19) ──────────────────────────────────────────────────

/**
 * A coupon code as typed: trimmed, 3–40 letters, digits, dash or underscore.
 * Refused before it reaches the promotions module, so a pasted sentence or
 * a script's payload costs no query. Case is kept — the route tries the
 * code as typed, then upper-cased (codes are usually printed in capitals).
 */
export function parseCouponBody(body: unknown): { ok: true; cartId: string; code: string } | { ok: false; message: string } {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const cartId = typeof record.cartId === "string" ? record.cartId.trim() : "";
  if (!cartId) return { ok: false, message: "cartId: expected the cart id" };
  const code = typeof record.code === "string" ? record.code.trim() : "";
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(code)) {
    return { ok: false, message: "code: that does not look like a coupon code" };
  }
  return { ok: true, cartId, code };
}

/** The spellings to try for a typed code, as typed first. */
export function couponSpellings(code: string): string[] {
  const upper = code.toUpperCase();
  return upper === code ? [code] : [code, upper];
}

// ── Gift message (plan 16 B21) ─────────────────────────────────────────────

/** Cart metadata key; Medusa copies cart metadata onto the order. */
export const GIFT_MESSAGE_KEY = "siumora_gift_message";
export const GIFT_MESSAGE_MAX = 150;

/**
 * The gift message as it may go on the order and the packing slip: trimmed,
 * control characters and runs of whitespace collapsed (it prints on a card,
 * not in a terminal), at most 150 characters. Switched off, any message is
 * dropped rather than refused — the shopper did nothing wrong. Too long is
 * a field error under the box it came from.
 *
 * `value: undefined` means "no message on the order".
 */
export function cleanGiftMessage(
  raw: unknown,
  enabled: boolean,
): { ok: true; value: string | undefined } | { ok: false; refusal: CheckoutRefusal } {
  if (!enabled || typeof raw !== "string") return { ok: true, value: undefined };
  const message = raw.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
  if (message.length === 0) return { ok: true, value: undefined };
  if (message.length > GIFT_MESSAGE_MAX) {
    const problem = `Keep the gift message to ${GIFT_MESSAGE_MAX} characters.`;
    return {
      ok: false,
      refusal: { status: 400, body: { error: "invalid_gift_message", message: problem, fields: { giftMessage: problem } } },
    };
  }
  return { ok: true, value: message };
}
