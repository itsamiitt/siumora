import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { completeCartWorkflow } from "@medusajs/medusa/core-flows";

import { checkoutSettings } from "../../../../../../lib/checkout-context";
import {
  SYSTEM_PAYMENT_PROVIDER,
  liveSessions,
  loadCart,
  openSession,
  paymentCredentials,
  razorpaySession,
  readSessionPayments,
  readyCart,
  refundUnplaced,
  refuse,
  stampPaymentMethod,
  stillAcceptable,
  totalPaise,
  type CartSnapshot,
  type Refusal,
} from "../../../../../../lib/checkout-cart";
import { adoptPlacedOrder } from "../../../../../../lib/checkout-identity";
import { type GstTxClient } from "../../../../../../modules/gst/allocate";
import { ensureInvoiceForOrder, type GraphQuery } from "../../../../../../modules/gst/issue";
import { verifyCheckoutSignature } from "../../../../../../modules/razorpay-payment/decide";
import {
  allocateIdentity,
  findIdentityByIdempotencyKey,
  type SqlClient,
} from "../../../../../../modules/siumora-order/allocate";
import {
  PAYMENTS_PAUSED,
  parseCompleteBody,
  type CheckoutPaymentMethod,
  type PaymentProof,
} from "../../../../../../modules/siumora-order/checkout-rules";
import {
  PLACED_STATUS,
  completionEnvelope,
} from "../../../../../../modules/siumora-order/identity";

/**
 * POST /store/siumora/carts/:cartId/complete — the Siumora checkout.
 *
 * Completes the cart into an order and allocates the SIU order number +
 * guest access key, returning the same envelope the Fastify /checkout
 * returns: { ok, orderNumber, status, invoiceNumber, accessKey }.
 *
 * Design decision (task item 2, written down as asked): allocation happens
 * here in the request path, NOT in an order-placed workflow hook, because
 * the checkout response must carry orderNumber + accessKey synchronously
 * and Medusa's order.placed event is asynchronous. completeCartWorkflow's
 * own documentation blesses exactly this wrapper shape: completion is
 * idempotent per cart, and linked records must be created check-before-
 * create — which allocateIdentity does atomically (ON CONFLICT on
 * order_id). A belt-and-braces order.placed subscriber
 * (src/subscribers/siumora-order-identity.ts) funnels through the same
 * atomic allocator, so orders placed outside this route (a Razorpay webhook
 * completing the cart) still get an identity and an invoice.
 *
 * Idempotency-Key: same key replays the original order's envelope; the same
 * key with a DIFFERENT cart is the Fastify 422 idempotency_key_reused.
 * (Fastify hashes the whole request body; the cart id is the load-bearing
 * part of it here — a coarser but honest equivalent.)
 *
 * Plan 16 — nothing the client sent about money is trusted:
 * - B1 the kill-switch refuses (503 payments_paused) before anything else,
 *   replays included, exactly where Fastify's /checkout refuses;
 * - COD (Phase A): lib/checkout-cart.ts readyCart validates the address,
 *   re-derives serviceability and COD terms, runs the verified-phone gate,
 *   folds the COD fee into shipping, and the system provider completes.
 * - Prepaid (Phase B): payment came first, through the prepare route and
 *   Checkout.js. This route checks the handler's signature, that the paid
 *   Razorpay order is the cart's session and the cart still totals what was
 *   paid, then completes — the provider asks Razorpay itself whether the
 *   money is there. If the money is there but the order cannot be placed,
 *   the payment is refunded (B12, 409 paid_not_placed).
 */

/**
 * The statutory invoice for a completed order (M2 gst module).
 *
 * A refusal (a line without HSN/slab, totals that fail the reconciliation
 * assertion) must not fail a checkout whose order already stands — the
 * order stands, the envelope says invoiceNumber null (a shape the contract
 * allows), and the log shouts so the series gap is chased, not discovered
 * at filing.
 */
async function invoiceNumberForOrder(
  req: MedusaRequest,
  pg: GstTxClient,
  query: GraphQuery,
  orderId: string,
): Promise<string | null> {
  try {
    const invoice = await ensureInvoiceForOrder(pg, query, orderId);
    return invoice.invoice_number;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER) as {
      error(msg: string): void;
    };
    logger.error(
      `gst invoice was not issued for order ${orderId} — chase this, the books depend on it: ${message}`,
    );
    return null;
  }
}

/** The order the cart became, when it already completed. */
async function orderOfCart(req: MedusaRequest, cartId: string): Promise<string | undefined> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: links } = await query.graph({
    entity: "order_cart",
    fields: ["order_id"],
    filters: { cart_id: cartId },
  });
  return (links[0] as { order_id: string } | undefined)?.order_id;
}

/** COD: ready the cart, make sure the system session is the active one. */
async function prepareCod(
  req: MedusaRequest,
  cart: CartSnapshot,
  settings: Awaited<ReturnType<typeof checkoutSettings>>,
): Promise<Refusal | undefined> {
  // A Razorpay session that already has money behind it must not be
  // replaced by COD — the shopper paid; that payment completes the order.
  const prepaid = razorpaySession(cart);
  if (prepaid) {
    const reading = await readSessionPayments(req, prepaid);
    if (reading && (reading.state === "captured" || reading.state === "authorized")) {
      return {
        status: 409,
        body: {
          error: "already_paid",
          message: "This bag is already paid online — we are confirming the order.",
        },
      };
    }
  }

  const ready = await readyCart(req, cart, { paymentMethod: "cod", settings });
  if (!ready.ok) return ready.refusal;
  const active = liveSessions(ready.cart);
  if (!active.some((session) => session.provider_id === SYSTEM_PAYMENT_PROVIDER)) {
    await openSession(req, ready.cart, SYSTEM_PAYMENT_PROVIDER);
  }
  return undefined;
}

/**
 * Prepaid: the browser says it paid. Believe Razorpay, not the browser —
 * the signature gates the cheap forgeries, the session match binds the
 * payment to this bag, and the provider's authorize reads the payment from
 * Razorpay before anything is placed.
 */
async function checkPrepaid(
  req: MedusaRequest,
  cart: CartSnapshot,
  proof: PaymentProof,
  paymentMethod: CheckoutPaymentMethod,
  settings: Awaited<ReturnType<typeof checkoutSettings>>,
): Promise<Refusal | undefined> {
  const credentials = await paymentCredentials(req);
  if (!verifyCheckoutSignature(proof, credentials.keySecret)) {
    return {
      status: 400,
      body: { error: "invalid_payment", message: "We could not verify that payment. Nothing was placed." },
    };
  }
  const session = razorpaySession(cart);
  if (!session || session.data?.razorpay_order_id !== proof.orderId) {
    return {
      status: 409,
      body: {
        error: "payment_mismatch",
        message: "That payment is not for this bag. If you were charged, it will be refunded.",
      },
    };
  }
  // The bag or its address changed after the payment was opened (another
  // tab, a stock correction): what was paid is not what the order would be,
  // or the parcel can no longer go where it was paid to go.
  const changed =
    totalPaise(cart) !== session.data?.amount_paise
      ? true
      : await stillAcceptable(req, cart, { paymentMethod, settings });
  if (changed) {
    const outcome = await refundUnplaced(req, session);
    return {
      status: 409,
      body: {
        error: "paid_not_placed",
        message:
          outcome === "nothing_taken"
            ? "Your bag changed. Nothing was charged — review it and pay again."
            : "Your bag changed after paying. We are refunding the payment in full — review your bag and pay again.",
      },
    };
  }
  return undefined;
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const cartId = req.params.cartId!;
  const container = req.scope;
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const pg = pgConnection as unknown as SqlClient;
  const gstPg = pgConnection as unknown as GstTxClient;
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const parsed = parseCompleteBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "invalid_request", message: parsed.message });
    return;
  }
  const { paymentMethod, proof } = parsed.value;

  // ── B1: the kill-switch. Before the idempotency replay, like Fastify: a
  // paused checkout answers paused, whatever the request is.
  const settings = await checkoutSettings(req);
  if (!settings.paymentsEnabled) {
    refuse(res, PAYMENTS_PAUSED);
    return;
  }

  const rawKey = req.headers["idempotency-key"];
  const idempotencyKey =
    typeof rawKey === "string" && rawKey.length > 0 && rawKey.length <= 255
      ? rawKey
      : null;

  // ── Replay? Same key returns the original order, never a second one. ──
  if (idempotencyKey) {
    const replayed = await findIdentityByIdempotencyKey(pg, idempotencyKey);
    if (replayed) {
      if (replayed.cart_id && replayed.cart_id !== cartId) {
        res.status(422).json({
          error: "idempotency_key_reused",
          message: "That idempotency key was used for a different request.",
        });
        return;
      }
      res.setHeader("Idempotent-Replay", "true");
      // A replay serves the stored invoice too (idempotent issue: an order
      // that somehow missed its invoice gets it now, never a second one).
      res.json({
        ...completionEnvelope(replayed, PLACED_STATUS),
        invoiceNumber: await invoiceNumberForOrder(
          req,
          gstPg,
          query as unknown as GraphQuery,
          replayed.order_id,
        ),
      });
      return;
    }
  }

  const cart = await loadCart(req, cartId);
  if (!cart) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  let orderId: string;
  // Only the request that completes the cart may adopt its order: a replay
  // (same key, or an already-completed cart id) must not hand a guest's
  // order to whoever replays it (security review).
  let completedHere = false;

  if (cart.completed_at) {
    // Already completed — Medusa's native semantics make completion
    // idempotent per cart; the order behind it is this cart's order (a
    // Razorpay webhook may have completed it before the browser got here).
    const existing = await orderOfCart(req, cartId);
    if (!existing) {
      res.status(409).json({
        error: "checkout_failed",
        message: "This cart is closed but its order could not be found.",
      });
      return;
    }
    orderId = existing;
    res.setHeader("Idempotent-Replay", "true");
  } else {
    const refusal =
      paymentMethod === "cod"
        ? await prepareCod(req, cart, settings)
        : await checkPrepaid(req, cart, proof!, paymentMethod, settings);
    if (refusal) {
      refuse(res, refusal);
      return;
    }
    if (paymentMethod !== "cod") await stampPaymentMethod(req, cart, paymentMethod);

    try {
      const { result } = await completeCartWorkflow(container).run({
        input: { id: cartId },
      });
      orderId = result.id;
      completedHere = true;
    } catch (error) {
      // A webhook may have completed the cart while this request ran.
      const raced = await orderOfCart(req, cartId);
      if (raced) {
        orderId = raced;
      } else if (paymentMethod !== "cod") {
        // B12: money may have moved for an order that does not exist.
        const session = razorpaySession(cart);
        const reading = session ? await readSessionPayments(req, session) : undefined;
        if (!reading || reading.state === "pending") {
          // Razorpay has not settled it yet: the webhook or recon completes
          // the order when it does. Nothing to refund, nothing placed yet.
          res.status(409).json({
            error: "payment_pending",
            message: "We have not received your payment yet. If you were charged, your order will confirm in a few minutes.",
          });
          return;
        }
        const outcome = await refundUnplaced(req, session!);
        res.status(409).json({
          error: "paid_not_placed",
          message:
            outcome === "refund_failed"
              ? "We could not place your order. Your payment will be refunded — our team has been alerted."
              : "We could not place your order, so your payment is being refunded in full.",
        });
        return;
      } else {
        // Stock ran out between add and complete, … — the caller's request
        // failed, not the server: same 409 checkout_failed contract as the
        // Fastify route.
        const message =
          error instanceof Error ? error.message : "Checkout could not be completed.";
        res.status(409).json({ error: "checkout_failed", message });
        return;
      }
    }
    res.setHeader("Idempotent-Replay", completedHere ? "false" : "true");
  }

  const allocation = await allocateIdentity(pg, { orderId, cartId, idempotencyKey });
  if (allocation.kind === "key_conflict") {
    res.status(422).json({
      error: "idempotency_key_reused",
      message: "That idempotency key was used for a different request.",
    });
    return;
  }

  // A signed-in shopper's order is theirs, and the address joins their book.
  if (completedHere) await adoptPlacedOrder(req, orderId, cart.shipping_address);

  // Identity first, then the statutory invoice — the M2 gst module. Both
  // COD and a paid prepaid order are confirmed at placement, so completion
  // is what raises the invoice.
  res.json({
    ...completionEnvelope(allocation.identity, PLACED_STATUS),
    invoiceNumber: await invoiceNumberForOrder(
      req,
      gstPg,
      query as unknown as GraphQuery,
      orderId,
    ),
  });
}
