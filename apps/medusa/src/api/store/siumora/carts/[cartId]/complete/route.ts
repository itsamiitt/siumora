import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  addShippingMethodToCartWorkflow,
  completeCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
} from "@medusajs/medusa/core-flows";

import { type GstTxClient } from "../../../../../../modules/gst/allocate";
import { ensureInvoiceForOrder, type GraphQuery } from "../../../../../../modules/gst/issue";
import {
  allocateIdentity,
  findIdentityByIdempotencyKey,
  type SqlClient,
} from "../../../../../../modules/siumora-order/allocate";
import {
  PLACED_STATUS,
  completionEnvelope,
} from "../../../../../../modules/siumora-order/identity";

/**
 * POST /store/siumora/carts/:cartId/complete — the Siumora checkout.
 *
 * Completes the cart into an order (COD path: Medusa's system payment
 * provider stands in until a real provider ports — no money moves at
 * placement for COD anyway) and allocates the SIU order number + guest
 * access key, returning the same envelope the Fastify /checkout returns:
 * { ok, orderNumber, status, invoiceNumber, accessKey }.
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
 * atomic allocator, so orders placed outside this route still get an
 * identity and the race between the two resolves to one row by
 * construction.
 *
 * Idempotency-Key: same key replays the original order's envelope; the same
 * key with a DIFFERENT cart is the Fastify 422 idempotency_key_reused.
 * (Fastify hashes the whole request body; the cart id is the load-bearing
 * part of it here — a coarser but honest equivalent.)
 */

/** Seeded by src/scripts/seed.ts; priced to core's shippingFor tiers. */
const SHIPPING_OPTION_NAME = "Standard Delivery";

/**
 * The statutory invoice for a completed order (M2 gst module).
 *
 * Fastify parity: a COD order that needs no verification confirms at
 * placement, and confirmation is what raises the invoice (packages/db
 * placeOrder; api.test.ts "places an order and issues an invoice"). Here
 * placement IS completion, so the invoice is issued right after identity
 * allocation and the envelope's invoiceNumber flips from null to the real
 * series number.
 *
 * A refusal (a line without HSN/slab, totals that fail the reconciliation
 * assertion) must not fail a checkout whose order already stands — same
 * philosophy as the Fastify razorpay-create failure: the order stands, the
 * envelope says invoiceNumber null (a shape the contract allows), and the
 * log shouts so the series gap is chased, not discovered at filing.
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

/** Medusa's built-in system provider — the "no provider yet" COD stand-in. */
const SYSTEM_PAYMENT_PROVIDER = "pp_system_default";

interface CartSnapshot {
  id: string;
  completed_at: string | Date | null;
  items?: Array<{ id: string; requires_shipping?: boolean } | null> | null;
  shipping_methods?: Array<{ id: string } | null> | null;
  payment_collection?: {
    id: string;
    payment_sessions?: Array<{ id: string; status: string } | null> | null;
  } | null;
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const cartId = req.params.cartId!;
  const container = req.scope;
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const pg = pgConnection as unknown as SqlClient;
  const gstPg = pgConnection as unknown as GstTxClient;
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

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

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "completed_at",
      "items.id",
      "items.requires_shipping",
      "shipping_methods.id",
      "payment_collection.id",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.status",
    ],
    filters: { id: cartId },
  });
  const cart = carts[0] as CartSnapshot | undefined;
  if (!cart) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  let orderId: string;

  if (cart.completed_at) {
    // Already completed — Medusa's native semantics make completion
    // idempotent per cart; the order behind it is this cart's order.
    const { data: links } = await query.graph({
      entity: "order_cart",
      fields: ["order_id"],
      filters: { cart_id: cartId },
    });
    const link = links[0] as { order_id: string } | undefined;
    if (!link) {
      res.status(409).json({
        error: "checkout_failed",
        message: "This cart is closed but its order could not be found.",
      });
      return;
    }
    orderId = link.order_id;
    res.setHeader("Idempotent-Replay", "true");
  } else {
    const items = (cart.items ?? []).filter(Boolean);
    if (items.length === 0) {
      // Same refusal, same words, as the Fastify checkout.
      res.status(409).json({ error: "checkout_failed", message: "Your bag is empty." });
      return;
    }

    // ── Shipping method (before payment, so the session amount is final).
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
        res.status(503).json({
          error: "shipping_not_configured",
          message:
            "No shipping option is configured. Run the Medusa seed (npx medusa exec ./src/scripts/seed.ts).",
        });
        return;
      }
      await addShippingMethodToCartWorkflow(container).run({
        input: { cart_id: cartId, options: [{ id: option.id }] },
      });
    }

    // ── Payment collection + system session (COD: nothing is charged). ──
    let paymentCollectionId = cart.payment_collection?.id;
    if (!paymentCollectionId) {
      await createPaymentCollectionForCartWorkflow(container).run({
        input: { cart_id: cartId },
      });
      const { data: refreshed } = await query.graph({
        entity: "cart",
        fields: ["payment_collection.id"],
        filters: { id: cartId },
      });
      paymentCollectionId = (
        refreshed[0] as CartSnapshot | undefined
      )?.payment_collection?.id;
    }
    if (!paymentCollectionId) {
      res.status(409).json({
        error: "checkout_failed",
        message: "A payment collection could not be initiated for this cart.",
      });
      return;
    }
    const sessions = (cart.payment_collection?.payment_sessions ?? []).filter(Boolean);
    if (sessions.length === 0) {
      await createPaymentSessionsWorkflow(container).run({
        input: {
          payment_collection_id: paymentCollectionId,
          provider_id: SYSTEM_PAYMENT_PROVIDER,
        },
      });
    }

    try {
      const { result } = await completeCartWorkflow(container).run({
        input: { id: cartId },
      });
      orderId = result.id;
    } catch (error) {
      // Stock ran out between add and complete, payment session refused, …
      // — the caller's request failed, not the server: same 409
      // checkout_failed contract as the Fastify route.
      const message =
        error instanceof Error ? error.message : "Checkout could not be completed.";
      res.status(409).json({ error: "checkout_failed", message });
      return;
    }
    res.setHeader("Idempotent-Replay", "false");
  }

  const allocation = await allocateIdentity(pg, { orderId, cartId, idempotencyKey });
  if (allocation.kind === "key_conflict") {
    res.status(422).json({
      error: "idempotency_key_reused",
      message: "That idempotency key was used for a different request.",
    });
    return;
  }

  // Identity first, then the statutory invoice — the M2 gst module. COD
  // confirmed at placement, so completion is what raises the invoice.
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
