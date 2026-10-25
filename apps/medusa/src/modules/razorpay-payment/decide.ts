import { createHmac, timingSafeEqual } from "node:crypto";

import type { RazorpayPayment } from "./client.ts";

/**
 * The provider's decisions, pure — so node --test can pin every branch the
 * provider, the routes and the recon job take on money (plan 16 Phase B).
 *
 * Money crosses three units here: Razorpay speaks integer paise, Medusa
 * speaks major rupees (sometimes as a BigNumber), and the storefront speaks
 * paise. Every conversion refuses rather than rounds — an amount that is not
 * whole paise went through a float somewhere, and that is a bug to surface.
 */

// ── Signatures ─────────────────────────────────────────────────────────────

function safeEqualHex(expected: string, given: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A webhook body is genuine when its HMAC-SHA256 under the webhook secret
 * matches the X-Razorpay-Signature header — the same check as Fastify's
 * verifyRazorpaySignature. A missing secret refuses rather than skips: a
 * production box without one would otherwise accept anyone's "payment".
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer | undefined,
  signature: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !signature || rawBody === undefined) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
}

/**
 * The Checkout.js success handler's proof: HMAC-SHA256 of
 * "order_id|payment_id" under the key secret. Checked before completing the
 * cart so a forged "I paid" never reaches the order path (the provider then
 * asks Razorpay itself anyway — this is the cheap first gate).
 */
export function verifyCheckoutSignature(
  input: { orderId: string; paymentId: string; signature: string },
  keySecret: string | undefined,
): boolean {
  if (!keySecret) return false;
  const expected = createHmac("sha256", keySecret)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest("hex");
  return safeEqualHex(expected, input.signature);
}

// ── Money ──────────────────────────────────────────────────────────────────

/** Medusa's amount (number, numeric string, or BigNumber) → integer paise. */
export function paiseFromMajor(amount: unknown): number {
  const unwrapped =
    typeof amount === "number"
      ? amount
      : typeof amount === "string"
        ? Number(amount)
        : JSON.parse(JSON.stringify(amount ?? null));
  const major = typeof unwrapped === "string" ? Number(unwrapped) : unwrapped;
  if (typeof major !== "number" || !Number.isFinite(major)) {
    throw new Error(`amount is not numeric: ${JSON.stringify(amount)}`);
  }
  const paise = Math.round(major * 100);
  if (Math.abs(major * 100 - paise) > 1e-6) {
    throw new Error(`amount ${major} does not convert to integer paise`);
  }
  return paise;
}

export function majorFromPaise(paise: number): number {
  if (!Number.isInteger(paise)) throw new Error(`${paise} is not whole paise`);
  return paise / 100;
}

// ── What Razorpay says about an order ──────────────────────────────────────

export type PaymentReading =
  | { readonly state: "captured"; readonly paymentId: string }
  | { readonly state: "authorized"; readonly paymentId: string }
  | { readonly state: "pending" }
  | { readonly state: "mismatch"; readonly paymentId: string; readonly amountPaise: number }
  | { readonly state: "refunded"; readonly paymentId: string };

/**
 * Read a Razorpay order's payments against what the cart owes.
 *
 * Captured beats authorized beats nothing. A payment for any other amount is
 * never accepted as this cart's payment — the order id binds the amount on
 * Razorpay's side, so a mismatch means something is wrong, and the answer is
 * to refuse and refund, not to complete.
 */
export function readPayments(
  payments: readonly RazorpayPayment[],
  expectedPaise: number,
): PaymentReading {
  const live = payments.filter((p) => p.status === "captured" || p.status === "authorized");
  const wrong = live.find((p) => typeof p.amount === "number" && p.amount !== expectedPaise);
  if (wrong) return { state: "mismatch", paymentId: wrong.id, amountPaise: wrong.amount! };

  const captured = live.find((p) => p.status === "captured");
  if (captured) return { state: "captured", paymentId: captured.id };
  const authorized = live.find((p) => p.status === "authorized");
  if (authorized) return { state: "authorized", paymentId: authorized.id };
  const refunded = payments.find((p) => p.status === "refunded");
  if (refunded) return { state: "refunded", paymentId: refunded.id };
  return { state: "pending" };
}

// ── Webhooks ───────────────────────────────────────────────────────────────

export type WebhookEvent =
  | {
      readonly kind: "captured" | "authorized" | "failed";
      readonly razorpayOrderId: string;
      readonly paymentId: string;
      readonly amountPaise: number;
      /** When the payment carries it; otherwise resolved by order id. */
      readonly sessionId?: string;
    }
  | { readonly kind: "ignored"; readonly reason: string };

interface PaymentEntityWire {
  id?: unknown;
  order_id?: unknown;
  amount?: unknown;
  notes?: unknown;
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

function sessionIdIn(notes: unknown): string | undefined {
  return notes !== null && typeof notes === "object"
    ? asString((notes as Record<string, unknown>).session_id)
    : undefined;
}

/**
 * The parts of a (verified) Razorpay webhook body that move money:
 * payment.captured and order.paid → captured, payment.authorized → the
 * drop-off case to capture, payment.failed → failed. Anything else is
 * acknowledged and ignored — a payload we cannot route is not the
 * provider's fault to retry forever.
 */
export function parseWebhook(body: unknown): WebhookEvent {
  const record = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const event = asString(record.event);
  const payload = (record.payload ?? {}) as Record<string, { entity?: unknown } | undefined>;
  const payment = (payload.payment?.entity ?? {}) as PaymentEntityWire;
  const order = (payload.order?.entity ?? {}) as { id?: unknown; notes?: unknown };

  const kind =
    event === "payment.captured" || event === "order.paid"
      ? "captured"
      : event === "payment.authorized"
        ? "authorized"
        : event === "payment.failed"
          ? "failed"
          : undefined;
  if (!kind) return { kind: "ignored", reason: event ?? "no event" };

  const paymentId = asString(payment.id);
  const razorpayOrderId = asString(payment.order_id) ?? asString(order.id);
  const amountPaise = typeof payment.amount === "number" ? payment.amount : undefined;
  if (!paymentId || !razorpayOrderId || amountPaise === undefined) {
    return { kind: "ignored", reason: "no payment reference" };
  }
  const sessionId = sessionIdIn(payment.notes) ?? sessionIdIn(order.notes);
  return { kind, razorpayOrderId, paymentId, amountPaise, ...(sessionId ? { sessionId } : {}) };
}

// ── Recon ──────────────────────────────────────────────────────────────────

/**
 * What the recon sweep does with an open Razorpay session, from Razorpay's
 * own answer: replay the webhook Medusa may have missed (captured, or the
 * bare authorized drop-off case), flag a wrong amount for a human, or leave
 * a still-unpaid order alone.
 */
export function reconAction(
  reading: PaymentReading,
): "captured" | "authorized" | "flag" | "none" {
  switch (reading.state) {
    case "captured":
      return "captured";
    case "authorized":
      return "authorized";
    case "mismatch":
      return "flag";
    default:
      return "none";
  }
}
