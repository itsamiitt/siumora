import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import { checkoutSettings } from "../../../../../../lib/checkout-context";
import {
  loadCart,
  openSession,
  razorpaySession,
  readSessionPayments,
  readyCart,
  refuse,
  totalPaise,
  type SessionSnapshot,
} from "../../../../../../lib/checkout-cart";
import { RAZORPAY_PROVIDER_ID } from "../../../../../../modules/razorpay-payment/index";
import { stampLedgerCart, type RawClient } from "../../../../../../modules/siumora-order/razorpay-ledger";
import {
  PAYMENTS_PAUSED,
  type CheckoutPaymentMethod,
} from "../../../../../../modules/siumora-order/checkout-rules";

/**
 * POST /store/siumora/carts/:cartId/prepare — open a prepaid payment
 * (plan 16 Phase B, B9). Body: { paymentMethod: "upi" | "card" | "netbanking" }.
 *
 * Payment before the order: this readies the cart exactly as completion
 * would (address, serviceability, shipping, a collection sized to the total)
 * and opens a Razorpay order for that total. The response is what the
 * browser needs to open Checkout.js — never a secret:
 *   { razorpay: { orderId, keyId, amountPaise } }
 * Nothing is placed and the bag is untouched; if the shopper closes the
 * modal, calling this again reuses the same Razorpay order while the total
 * is unchanged and the order is under REUSE_MS old (B14), so a retry is not
 * a second order on Razorpay's side either.
 *
 * Refusals mirror completion's: 503 payments_paused, 400 invalid_address
 * (with `fields`), 409 not_serviceable / prepaid_unavailable /
 * checkout_failed, and 409 already_paid when the bag's open Razorpay order
 * already has money behind it — the browser should complete, not pay twice.
 */

const PREPAID: ReadonlySet<string> = new Set(["upi", "card", "netbanking"]);

/** How long an unpaid Razorpay order is offered again before a fresh one. */
const REUSE_MS = 30 * 60_000;

function handoff(session: SessionSnapshot) {
  return {
    orderId: session.data!.razorpay_order_id as string,
    keyId: session.data!.key_id as string,
    amountPaise: session.data!.amount_paise as number,
  };
}

function reusable(session: SessionSnapshot | undefined, amountPaise: number, now: number): boolean {
  const data = session?.data;
  const created = typeof data?.created_at === "string" ? Date.parse(data.created_at) : NaN;
  return (
    !!session &&
    typeof data?.razorpay_order_id === "string" &&
    data.amount_paise === amountPaise &&
    Number.isFinite(created) &&
    now - created < REUSE_MS
  );
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const body = (req.body ?? {}) as { paymentMethod?: unknown };
  const method = body.paymentMethod;
  if (typeof method !== "string" || !PREPAID.has(method)) {
    res.status(400).json({
      error: "invalid_request",
      message: "paymentMethod: expected upi, card or netbanking (cash on delivery needs no payment step)",
    });
    return;
  }

  const settings = await checkoutSettings(req);
  if (!settings.paymentsEnabled) {
    refuse(res, PAYMENTS_PAUSED);
    return;
  }

  const cart = await loadCart(req, req.params.cartId!);
  if (!cart) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (cart.completed_at) {
    res.status(409).json({ error: "cart_completed", message: "This bag has already become an order." });
    return;
  }

  // Money already behind the open Razorpay order: never open a second one.
  const existing = razorpaySession(cart);
  if (existing) {
    const reading = await readSessionPayments(req, existing);
    if (reading && (reading.state === "captured" || reading.state === "authorized")) {
      res.status(409).json({
        error: "already_paid",
        message: "This bag is already paid — confirming your order.",
        razorpay: handoff(existing),
      });
      return;
    }
  }

  const ready = await readyCart(req, cart, {
    paymentMethod: method as CheckoutPaymentMethod,
    settings,
  });
  if (!ready.ok) {
    refuse(res, ready.refusal);
    return;
  }

  const amountPaise = totalPaise(ready.cart);
  let session = razorpaySession(ready.cart);
  if (!reusable(session, amountPaise, Date.now())) {
    try {
      session = await openSession(req, ready.cart, RAZORPAY_PROVIDER_ID);
    } catch (error) {
      res.status(502).json({
        error: "payment_unavailable",
        message:
          error instanceof Error && /Nothing was charged/.test(error.message)
            ? error.message
            : "Online payment could not be started. Nothing was charged — try again.",
      });
      return;
    }
  }
  if (!session || typeof session.data?.razorpay_order_id !== "string") {
    res.status(502).json({
      error: "payment_unavailable",
      message: "Online payment could not be started. Nothing was charged — try again.",
    });
    return;
  }

  // The ledger row the provider wrote learns its cart, so the recon sweep
  // can tell a completed bag from an abandoned one (security review, item 2).
  // Best effort: without the stamp recon judges by the live session alone.
  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as RawClient;
  await stampLedgerCart(pg, session.data.razorpay_order_id, ready.cart.id).catch(() => undefined);

  res.json({ razorpay: handoff(session) });
}
