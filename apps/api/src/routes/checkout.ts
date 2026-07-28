import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { evaluateCod, initialStatus, scoreAddress, scoreRto } from "@siumora/core";
import {
  eq,
  getCartLines,
  listOrdersForCustomer,
  placeOrder,
  schema,
} from "@siumora/db";

import { resolveViewer, type Viewer } from "../lib/auth.ts";
import { withIdempotency } from "../lib/idempotency.ts";

/**
 * Checkout.
 *
 * Every decision that costs money — COD eligibility, the fee, whether the order
 * is held for confirmation — is made here from the address the customer
 * actually submitted. A client-supplied fee or risk band would be trivially
 * forgeable, so none is accepted.
 */

const addressSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().regex(/^[6-9]\d{9}$/, "expected a 10-digit Indian mobile"),
  line1: z.string().min(1).max(300),
  line2: z.string().max(300).optional(),
  landmark: z.string().max(200).optional(),
  city: z.string().min(1).max(120),
  stateCode: z.string().regex(/^\d{2}$/),
  pincode: z.string().regex(/^[1-9]\d{5}$/),
});

const checkoutSchema = z.object({
  cartId: z.uuid(),
  address: addressSchema,
  paymentMethod: z.enum(["upi", "card", "netbanking", "wallet", "cod"]),
  /** Minted by the client so the browser pixel and server event share one id. */
  eventId: z.uuid(),
});

/**
 * What a signed-in shopper's history contributes to the risk picture.
 *
 * The delivery number must be the number they actually proved. Without that
 * check a single verified account would launder any address into the lower
 * risk band — which is precisely the RTO the score exists to catch.
 */
async function customerSignals(
  server: FastifyInstance,
  viewer: Viewer | undefined,
  deliveryPhone: string | undefined,
): Promise<{
  phoneVerified: boolean;
  isNewCustomer: boolean;
  successfulOrders: number;
  customerId?: string;
}> {
  if (!viewer) {
    return { phoneVerified: false, isNewCustomer: true, successfulOrders: 0 };
  }

  const past = await listOrdersForCustomer(server.db, viewer.customer.id);

  return {
    phoneVerified: deliveryPhone === viewer.customer.phone,
    isNewCustomer: past.length === 0,
    successfulOrders: past.filter((order) => order.status === "delivered").length,
    customerId: viewer.customer.id,
  };
}

export async function registerCheckoutRoutes(server: FastifyInstance) {
  /**
   * Quote the checkout: delivery promise, COD eligibility and any fee.
   *
   * Read-only, so the storefront can call it as the customer types without
   * creating anything.
   */
  server.post("/checkout/quote", async (request) => {
    const body = z
      .object({
        cartId: z.uuid(),
        pincode: z.string().regex(/^[1-9]\d{5}$/),
        address: z.string().max(300).optional(),
        city: z.string().max(120).optional(),
        stateCode: z.string().regex(/^\d{2}$/).optional(),
        phone: z.string().max(20).optional(),
      })
      .parse(request.body);

    const viewer = await resolveViewer(request);
    const signals = await customerSignals(server, viewer, body.phone);

    const lines = await getCartLines(server.db, body.cartId);
    const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

    const [service] = await server.db
      .select()
      .from(schema.pincodeServiceability)
      .where(eq(schema.pincodeServiceability.pincode, body.pincode));

    const quality = scoreAddress({
      line1: body.address ?? "",
      city: body.city ?? "",
      stateCode: body.stateCode ?? "",
      pincode: body.pincode,
    });

    const risk = scoreRto({
      paymentMethod: "cod",
      orderValue: subtotal,
      addressScore: quality.score,
      phoneVerified: signals.phoneVerified,
      isNewCustomer: signals.isNewCustomer,
      pincodeRtoRate: service ? service.rtoRateBps / 10_000 : undefined,
    });

    const cod = evaluateCod({
      subtotal,
      pincodeCodServiceable: service?.codAvailable ?? false,
      rtoRisk: risk.risk,
      successfulOrders: signals.successfulOrders,
    });

    return {
      serviceable: service?.serviceable ?? false,
      estimatedDays: service?.estimatedDays ?? "—",
      addressQuality: quality,
      rto: { risk: risk.risk, score: risk.score },
      cod,
      // Told to the storefront so it can explain why the terms differ, rather
      // than a fee that silently appears or disappears between visits.
      phoneVerified: signals.phoneVerified,
    };
  });

  server.post("/checkout", async (request, reply) => {
    const body = checkoutSchema.parse(request.body);
    const key = request.headers["idempotency-key"];

    const viewer = await resolveViewer(request);
    const signals = await customerSignals(server, viewer, body.address.phone);

    const outcome = await withIdempotency(
      server.db,
      typeof key === "string" ? key : undefined,
      body,
      async () => {
        const lines = await getCartLines(server.db, body.cartId);
        if (lines.length === 0) {
          return { ok: false as const, message: "Your bag is empty." };
        }

        const subtotal = lines.reduce(
          (sum, l) => sum + l.unitPrice * l.quantity,
          0,
        );

        const [service] = await server.db
          .select()
          .from(schema.pincodeServiceability)
          .where(eq(schema.pincodeServiceability.pincode, body.address.pincode));

        // Re-derive the COD decision here rather than trusting anything the
        // client sent. A forged fee of zero would otherwise be honoured.
        const quality = scoreAddress(body.address);
        const risk = scoreRto({
          paymentMethod: body.paymentMethod === "cod" ? "cod" : "prepaid",
          orderValue: subtotal,
          addressScore: quality.score,
          phoneVerified: signals.phoneVerified,
          isNewCustomer: signals.isNewCustomer,
          pincodeRtoRate: service ? service.rtoRateBps / 10_000 : undefined,
        });

        let codFee = 0;
        let requiresCodConfirmation = false;

        if (body.paymentMethod === "cod") {
          const cod = evaluateCod({
            subtotal,
            pincodeCodServiceable: service?.codAvailable ?? false,
            rtoRisk: risk.risk,
            successfulOrders: signals.successfulOrders,
          });
          if (!cod.available) {
            return {
              ok: false as const,
              message: cod.reason ?? "Cash on delivery is not available.",
            };
          }
          codFee = cod.fee;
          requiresCodConfirmation = cod.verification !== "none";
        }

        const status = initialStatus(body.paymentMethod, {
          requiresCodConfirmation,
        });

        const placed = await placeOrder(server.db, {
          cartId: body.cartId,
          address: body.address,
          paymentMethod: body.paymentMethod,
          status,
          eventId: body.eventId,
          codFee,
          ...(signals.customerId ? { customerId: signals.customerId } : {}),
          phoneVerified: signals.phoneVerified,
        });

        if (!placed.ok) return { ok: false as const, message: placed.message };

        return {
          ok: true as const,
          orderNumber: placed.order.number,
          status: placed.order.status,
          invoiceNumber: placed.order.invoiceNumber,
          // Returned once. It is what lets a guest reopen their own order
          // later without the number alone being enough.
          accessKey: placed.order.accessKey,
        };
      },
    );

    if (outcome.status === "key_reused") {
      return reply.code(422).send({
        error: "idempotency_key_reused",
        message: "That idempotency key was used for a different request.",
      });
    }
    if (outcome.status === "in_progress") {
      return reply.code(409).send({
        error: "in_progress",
        message: "That request is still being processed.",
      });
    }

    const value = outcome.value;
    if (!value.ok) {
      return reply.code(409).send({ error: "checkout_failed", message: value.message });
    }

    // A replay returns the original order rather than creating a second one.
    reply.header("Idempotent-Replay", outcome.status === "replayed" ? "true" : "false");
    return value;
  });
}
