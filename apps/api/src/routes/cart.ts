import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { calculateTotals, shippingFor } from "@siumora/core";
import {
  addCartLine,
  clearCart,
  createCart,
  getCartLines,
  setCartLineQuantity,
} from "@siumora/db";

/**
 * Cart.
 *
 * The cart id is supplied by the caller and echoed back; the storefront keeps
 * it in an HTTP-only cookie. Totals are computed server-side on every read so a
 * client cannot present its own arithmetic at checkout.
 */

const cartIdSchema = z.object({ cartId: z.uuid() });

export async function registerCartRoutes(server: FastifyInstance) {
  server.post("/carts", async () => ({ cartId: await createCart(server.db) }));

  server.get("/carts/:cartId", async (request) => {
    const { cartId } = cartIdSchema.parse(request.params);
    const lines = await getCartLines(server.db, cartId);
    const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

    return {
      cartId,
      lines,
      // Intra-state until checkout knows the delivery state; the order recomputes.
      totals: calculateTotals(lines, {
        interState: false,
        shipping: shippingFor(subtotal),
      }),
    };
  });

  server.post("/carts/:cartId/lines", async (request, reply) => {
    const { cartId } = cartIdSchema.parse(request.params);
    const body = z
      .object({
        variantId: z.uuid(),
        quantity: z.number().int().positive().max(20).default(1),
      })
      .parse(request.body);

    const result = await addCartLine(
      server.db,
      cartId,
      body.variantId,
      body.quantity,
    );
    if (!result.ok) {
      // 409, not 400: the request was well-formed, the stock simply moved.
      return reply.code(409).send({ error: "unavailable", message: result.message });
    }

    const lines = await getCartLines(server.db, cartId);
    return { ok: true, count: lines.reduce((n, l) => n + l.quantity, 0) };
  });

  server.patch("/carts/:cartId/lines/:variantId", async (request, reply) => {
    const { cartId } = cartIdSchema.parse(request.params);
    const { variantId } = z.object({ variantId: z.uuid() }).parse(request.params);
    const body = z
      .object({ quantity: z.number().int().min(0).max(20) })
      .parse(request.body);

    const result = await setCartLineQuantity(
      server.db,
      cartId,
      variantId,
      body.quantity,
    );
    if (!result.ok) {
      return reply.code(409).send({ error: "unavailable", message: result.message });
    }

    const lines = await getCartLines(server.db, cartId);
    return { ok: true, count: lines.reduce((n, l) => n + l.quantity, 0) };
  });

  server.delete("/carts/:cartId", async (request) => {
    const { cartId } = cartIdSchema.parse(request.params);
    await clearCart(server.db, cartId);
    return { ok: true };
  });
}
