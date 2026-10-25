import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { ICartModuleService } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  addShippingMethodToCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
  refreshPaymentCollectionForCartWorkflow,
} from "@medusajs/medusa/core-flows";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { normalisePhone } from "@siumora/core";

import { createRazorpayClient } from "../modules/razorpay-payment/client";
import { razorpayCredentials, type RazorpayCredentials } from "../modules/razorpay-payment/credentials";
import { readPayments, type PaymentReading } from "../modules/razorpay-payment/decide";
import { RAZORPAY_PROVIDER_ID } from "../modules/razorpay-payment/index";
import { findPincode, type SqlClient as PincodeSqlClient } from "../modules/serviceability/lookup";
import { computeQuote } from "../modules/serviceability/serviceability";
import type { Settings } from "../modules/settings/settings";
import {
  GIFT_MESSAGE_KEY,
  PAYMENT_METHOD_KEY,
  cleanGiftMessage,
  decideCompletion,
  foldCodFee,
  paiseToMajor,
  validateCheckoutAddress,
  type CheckoutPaymentMethod,
} from "../modules/siumora-order/checkout-rules";
import {
  linePaise,
  majorToPaise,
  wireNumber,
  type OrderLineWire,
} from "../modules/siumora-order/identity";
import { customerSignals } from "./checkout-context";
import { codGate, type CheckoutAddress } from "./checkout-identity";

/**
 * Getting a cart ready to pay — shared by the prepare route (prepaid, before
 * the Razorpay modal) and the complete route (COD, and the prepaid finish).
 * Plan 16 Phases A and B. Nothing a client sent about money is trusted: the
 * address is validated, eligibility and the COD fee are re-derived, and the
 * payment collection is sized from the cart after the fee is on it.
 */

/** Seeded by src/scripts/seed.ts; priced to core's shippingFor tiers. */
const SHIPPING_OPTION_NAME = "Standard Delivery";

/** Medusa's built-in system provider — COD, where nothing is charged up front. */
export const SYSTEM_PAYMENT_PROVIDER = "pp_system_default";

export interface SessionSnapshot {
  id: string;
  status: string;
  provider_id: string;
  data?: Record<string, unknown> | null;
}

export interface CartSnapshot {
  id: string;
  completed_at: string | Date | null;
  /** BigNumber on the wire, majors. */
  total?: unknown;
  metadata?: Record<string, unknown> | null;
  shipping_address?: CheckoutAddress | null;
  items?: Array<(OrderLineWire & { id: string; requires_shipping?: boolean }) | null> | null;
  shipping_methods?: Array<{ id: string; amount?: unknown; data?: Record<string, unknown> | null } | null> | null;
  payment_collection?: {
    id: string;
    payment_sessions?: Array<SessionSnapshot | null> | null;
  } | null;
}

const CART_FIELDS = [
  "id",
  "completed_at",
  "total",
  "metadata",
  "shipping_address.*",
  // items.* rather than a field list: quantity is a computed field that
  // resolves undefined when named explicitly (probed on 2.18.0).
  "items.*",
  "items.variant.metadata",
  "shipping_methods.id",
  "shipping_methods.amount",
  "shipping_methods.data",
  "payment_collection.id",
  "payment_collection.payment_sessions.id",
  "payment_collection.payment_sessions.status",
  "payment_collection.payment_sessions.provider_id",
  "payment_collection.payment_sessions.data",
];

export async function loadCart(req: MedusaRequest, cartId: string): Promise<CartSnapshot | undefined> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({ entity: "cart", fields: CART_FIELDS, filters: { id: cartId } });
  return data[0] as CartSnapshot | undefined;
}

/** The cart's total in paise, as Medusa computes it now. */
export function totalPaise(cart: CartSnapshot): number {
  return majorToPaise(wireNumber(cart.total ?? 0, "cart.total"));
}

export function liveSessions(cart: CartSnapshot): SessionSnapshot[] {
  return (cart.payment_collection?.payment_sessions ?? []).filter(
    (session): session is SessionSnapshot => Boolean(session),
  );
}

/** A refusal the routes send as-is: status plus the Fastify-shaped body. */
export interface Refusal {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export function refuse(res: MedusaResponse, refusal: Refusal): void {
  res.status(refusal.status).json(refusal.body);
}

export async function paymentCredentials(req: MedusaRequest): Promise<RazorpayCredentials> {
  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  return razorpayCredentials(pg as unknown as Parameters<typeof razorpayCredentials>[0]);
}

/**
 * B2: serviceability and the COD decision for this cart, re-derived from
 * the address on the cart with the quote's own engines, signals and dial —
 * never the fee the client was shown.
 */
async function eligibility(req: MedusaRequest, cart: CartSnapshot, settings: Settings) {
  const address = cart.shipping_address ?? {};
  const pincode = address.postal_code ?? "";
  const phone = normalisePhone(address.phone ?? "") as string | undefined;
  const pg = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as PincodeSqlClient;

  const [row, signals] = await Promise.all([findPincode(pg, pincode), customerSignals(req, phone)]);
  const subtotalPaise = (cart.items ?? [])
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .reduce((sum, item) => sum + linePaise(item).unitPrice * wireNumber(item.quantity, "quantity"), 0);

  const quote = computeQuote({
    body: {
      cartId: cart.id,
      pincode,
      address: [address.address_1, address.address_2].filter(Boolean).join(", "),
      city: address.city ?? undefined,
      stateCode: address.province ?? undefined,
      phone,
    },
    row,
    subtotalPaise,
    signals,
    limits: { minOrder: settings.codMinOrder, maxOrder: settings.codMaxOrder, fee: settings.codFee },
  });
  return { serviceable: quote.serviceable, cod: quote.cod };
}

/**
 * B3: fold the COD fee (zero for prepaid, which also clears a fee left by an
 * earlier COD attempt) into the cart's shipping method.
 */
async function chargeCodFee(req: MedusaRequest, cartId: string, feePaise: number): Promise<void> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "shipping_methods.id", "shipping_methods.amount", "shipping_methods.data"],
    filters: { id: cartId },
  });
  const method = ((data[0] as CartSnapshot | undefined)?.shipping_methods ?? []).find(Boolean);
  if (!method) return;
  const folded = foldCodFee(
    {
      amountPaise: majorToPaise(wireNumber(method.amount, "shipping_methods.amount")),
      data: method.data ?? null,
    },
    feePaise,
  );
  const cartModule = req.scope.resolve<ICartModuleService>(Modules.CART);
  await cartModule.updateShippingMethods([
    { id: method.id, amount: paiseToMajor(folded.amountPaise), data: folded.data },
  ]);
}

/**
 * The read-only half of readyCart: would this cart still be accepted with
 * this method? Used when finishing a prepaid payment, where the cart was
 * readied before the modal opened and must not be changed after money moved.
 */
export async function stillAcceptable(
  req: MedusaRequest,
  cart: CartSnapshot,
  input: { paymentMethod: CheckoutPaymentMethod; settings: Settings },
): Promise<Refusal | undefined> {
  const address = validateCheckoutAddress(cart.shipping_address);
  if (!address.ok) return address.refusal;
  const { serviceable, cod } = await eligibility(req, cart, input.settings);
  const decision = decideCompletion({
    paymentMethod: input.paymentMethod,
    serviceable,
    cod,
    prepaidAvailable: true,
  });
  return decision.ok ? undefined : decision.refusal;
}

/**
 * Validate, price, gate and size a cart for `paymentMethod`. On success the
 * cart carries its shipping method, any COD fee, the method on its metadata
 * (copied to the order), and a payment collection sized to its total.
 * Returns the refreshed cart so callers see the final total and sessions.
 */
export async function readyCart(
  req: MedusaRequest,
  cart: CartSnapshot,
  input: { paymentMethod: CheckoutPaymentMethod; settings: Settings },
): Promise<{ ok: true; cart: CartSnapshot } | { ok: false; refusal: Refusal }> {
  const items = (cart.items ?? []).filter(Boolean);
  if (items.length === 0) {
    // Same refusal, same words, as the Fastify checkout.
    return { ok: false, refusal: { status: 409, body: { error: "checkout_failed", message: "Your bag is empty." } } };
  }

  // B5: an address a courier can find and an invoice can carry.
  const address = validateCheckoutAddress(cart.shipping_address);
  if (!address.ok) return { ok: false, refusal: address.refusal };

  // B21: the gift message, if the operator offers one, tidied and bounded
  // before it can reach the order and the packing slip.
  const gift = cleanGiftMessage(cart.metadata?.[GIFT_MESSAGE_KEY], input.settings.giftMessageEnabled);
  if (!gift.ok) return { ok: false, refusal: gift.refusal };

  // B2: serviceability and the method's terms, re-derived.
  const [{ serviceable, cod }, credentials] = await Promise.all([
    eligibility(req, cart, input.settings),
    paymentCredentials(req),
  ]);
  const decision = decideCompletion({
    paymentMethod: input.paymentMethod,
    serviceable,
    cod,
    prepaidAvailable: credentials.configured,
  });
  if (!decision.ok) return { ok: false, refusal: decision.refusal };

  // B4: COD needs the delivery phone verified — signed in on it — and a
  // large order to a new address a fresh code (auth plan phase 2). 403 with
  // the reason, so the storefront opens the matching sheet. Prepaid needs
  // no such proof.
  if (input.paymentMethod === "cod") {
    const gate = await codGate(req, cart);
    if (!gate.ok) return { ok: false, refusal: { status: 403, body: gate.body } };
  }

  const container = req.scope;
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  // Shipping method, before payment, so the collection amount is final.
  const needsShipping = items.some((item) => item!.requires_shipping);
  if (needsShipping && (cart.shipping_methods ?? []).filter(Boolean).length === 0) {
    const { data: options } = await query.graph({
      entity: "shipping_option",
      fields: ["id", "name"],
      filters: { name: SHIPPING_OPTION_NAME },
    });
    const option = options[0] as { id: string } | undefined;
    if (!option) {
      // Refused rather than completed unshippable — the seed owns this row.
      return {
        ok: false,
        refusal: {
          status: 503,
          body: {
            error: "shipping_not_configured",
            message: "No shipping option is configured. Run the Medusa seed (npx medusa exec ./src/scripts/seed.ts).",
          },
        },
      };
    }
    await addShippingMethodToCartWorkflow(container).run({
      input: { cart_id: cart.id, options: [{ id: option.id }] },
    });
  }

  await chargeCodFee(req, cart.id, decision.codFee);

  // The method (and the cleaned gift message) ride cart metadata, which
  // Medusa copies to the order.
  const cartModule = container.resolve<ICartModuleService>(Modules.CART);
  const { [GIFT_MESSAGE_KEY]: _typed, ...metadata } = cart.metadata ?? {};
  await cartModule.updateCarts([
    {
      id: cart.id,
      metadata: {
        ...metadata,
        ...(gift.value ? { [GIFT_MESSAGE_KEY]: gift.value } : {}),
        [PAYMENT_METHOD_KEY]: input.paymentMethod,
      },
    },
  ]);

  // A collection from an earlier attempt was sized before the fee: the
  // refresh re-sizes it to the cart total (a no-op when they agree) and
  // drops sessions made for the old amount.
  if (cart.payment_collection?.id) {
    await refreshPaymentCollectionForCartWorkflow(container).run({ input: { cart_id: cart.id } });
  } else {
    await createPaymentCollectionForCartWorkflow(container).run({ input: { cart_id: cart.id } });
  }

  const ready = await loadCart(req, cart.id);
  if (!ready?.payment_collection?.id) {
    return {
      ok: false,
      refusal: {
        status: 409,
        body: { error: "checkout_failed", message: "A payment collection could not be initiated for this cart." },
      },
    };
  }
  return { ok: true, cart: ready };
}

/**
 * Write the method onto the cart's metadata (copied to the order). The
 * storefront writes its own analytics keys there too, so the server's key is
 * re-stamped last — a cart's metadata is shopper-writable, the method is not.
 */
export async function stampPaymentMethod(
  req: MedusaRequest,
  cart: CartSnapshot,
  paymentMethod: CheckoutPaymentMethod,
): Promise<void> {
  const cartModule = req.scope.resolve<ICartModuleService>(Modules.CART);
  await cartModule.updateCarts([
    { id: cart.id, metadata: { ...(cart.metadata ?? {}), [PAYMENT_METHOD_KEY]: paymentMethod } },
  ]);
}

/** Open a session with `providerId` on the cart's collection (replacing the active one). */
export async function openSession(
  req: MedusaRequest,
  cart: CartSnapshot,
  providerId: string,
): Promise<SessionSnapshot | undefined> {
  await createPaymentSessionsWorkflow(req.scope).run({
    input: { payment_collection_id: cart.payment_collection!.id, provider_id: providerId },
  });
  const fresh = await loadCart(req, cart.id);
  return fresh ? liveSessions(fresh).find((session) => session.provider_id === providerId) : undefined;
}

/** What Razorpay says about the money behind a Razorpay session. */
export async function readSessionPayments(
  req: MedusaRequest,
  session: SessionSnapshot,
): Promise<PaymentReading | undefined> {
  const orderId = session.data?.razorpay_order_id;
  const amount = session.data?.amount_paise;
  if (typeof orderId !== "string" || typeof amount !== "number") return undefined;
  const credentials = await paymentCredentials(req);
  if (!credentials.keyId || !credentials.keySecret) return undefined;
  const client = createRazorpayClient({ keyId: credentials.keyId, keySecret: credentials.keySecret });
  const listed = await client.fetchOrderPayments(orderId);
  return listed.ok ? readPayments(listed.payments, amount) : undefined;
}

/** The cart's Razorpay session, if it has one. */
export function razorpaySession(cart: CartSnapshot): SessionSnapshot | undefined {
  return liveSessions(cart).find((session) => session.provider_id === RAZORPAY_PROVIDER_ID);
}

/**
 * B12: money arrived but no order could be placed (stock ran out, the bag
 * changed under the payment). Medusa refunds by itself only when its own
 * completion had already recorded the capture; this covers the rest, so a
 * shopper is never charged for an order that does not exist. Logged loudly:
 * every one of these is worth a look.
 */
export async function refundUnplaced(
  req: MedusaRequest,
  session: SessionSnapshot,
): Promise<"refunded" | "nothing_taken" | "refund_failed"> {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER) as {
    error(message: string): void;
  };
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "payment_session",
    fields: ["id", "payment.id", "payment.captured_at"],
    filters: { id: session.id },
  });
  const recorded = (data[0] as { payment?: { captured_at?: unknown } | null } | undefined)?.payment;
  if (recorded?.captured_at) {
    // Medusa's own compensation (compensatePaymentIfNeededStep) refunds it.
    logger.error(`paid_not_placed: session ${session.id} — Medusa compensation refunds`);
    return "refunded";
  }

  const reading = await readSessionPayments(req, session);
  if (!reading || reading.state === "pending" || reading.state === "refunded") {
    return reading?.state === "refunded" ? "refunded" : "nothing_taken";
  }
  const credentials = await paymentCredentials(req);
  const client = createRazorpayClient({ keyId: credentials.keyId!, keySecret: credentials.keySecret! });
  const amountPaise =
    reading.state === "mismatch" ? reading.amountPaise : (session.data!.amount_paise as number);
  if (reading.state === "authorized") {
    // Never captured: Razorpay releases an uncaptured authorization itself.
    logger.error(`paid_not_placed: session ${session.id} authorized only — left to lapse`);
    return "refunded";
  }
  const refund = await client.refundPayment(reading.paymentId, {
    amountPaise,
    notes: { reason: "order_not_placed", session_id: session.id },
  });
  logger.error(
    `paid_not_placed: session ${session.id} payment ${reading.paymentId} — ` +
      (refund.ok ? `refunded ${amountPaise} paise` : `REFUND FAILED: ${refund.error}`),
  );
  return refund.ok ? "refunded" : "refund_failed";
}
