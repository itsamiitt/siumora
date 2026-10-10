/**
 * POST /store/siumora/me/cart { cartId? } — tie the bag to the signed-in
 * account (auth plan phase 2).
 *
 * - This browser's open cart is transferred to the customer (Medusa's own
 *   transferCartCustomerWorkflow), so checkout knows who is buying.
 * - Bags the account left open on other devices in the last 30 days are
 *   folded into it, then marked merged so they are never folded twice.
 * - With no cart on this browser, the account's most recent open bag is
 *   handed back for the browser to adopt.
 *
 * Answers { cartId, merged } — the cart the browser should hold. Best
 * effort throughout: an out-of-stock line or a cart that refuses the
 * transfer is skipped, never allowed to fail the sign-in it rides on.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { ICartModuleService } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  addToCartWorkflow,
  transferCartCustomerWorkflow,
} from "@medusajs/medusa/core-flows";

import { requireSession } from "../../../../../lib/customer-guard";

const MERGED_KEY = "siumora_merged_into";
const LOOKBACK_MS = 30 * 86_400_000;
const MAX_MERGED_CARTS = 3;

interface CartRow {
  id: string;
  customer_id: string | null;
  completed_at: string | Date | null;
  updated_at: string | Date;
  metadata?: Record<string, unknown> | null;
  items?: Array<{ variant_id: string | null; quantity: unknown } | null> | null;
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const session = requireSession(req, res);
  if (!session) return;

  const raw = (req.body as { cartId?: unknown } | undefined)?.cartId;
  const cartId = typeof raw === "string" && /^cart_[A-Za-z0-9]{10,40}$/.test(raw) ? raw : undefined;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const fail = (what: string, error: unknown) =>
    logger.warn(`cart link: ${what}: ${error instanceof Error ? error.message : String(error)}`);

  let current: CartRow | undefined;
  if (cartId) {
    const { data } = await query.graph({
      entity: "cart",
      fields: ["id", "customer_id", "completed_at", "updated_at"],
      filters: { id: cartId },
    });
    current = data[0] as CartRow | undefined;
    if (current?.completed_at) current = undefined;
    if (current && current.customer_id !== session.customerId) {
      try {
        await transferCartCustomerWorkflow(req.scope).run({
          input: { id: current.id, customer_id: session.customerId },
        });
      } catch (error) {
        // Someone else's cart, or a transfer Medusa refuses: the browser
        // keeps an anonymous bag rather than a sign-in failure.
        fail("transfer refused", error);
        current = undefined;
      }
    }
  }

  const { data: owned } = await query.graph({
    entity: "cart",
    fields: ["id", "customer_id", "completed_at", "updated_at", "metadata", "items.variant_id", "items.quantity"],
    filters: { customer_id: session.customerId },
  });
  const since = Date.now() - LOOKBACK_MS;
  const open = (owned as CartRow[])
    .filter(
      (cart) =>
        !cart.completed_at &&
        cart.id !== current?.id &&
        !cart.metadata?.[MERGED_KEY] &&
        new Date(cart.updated_at).getTime() > since,
    )
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  if (!current) {
    // Nothing on this browser: adopt the account's latest bag as it is.
    res.json({ cartId: open[0]?.id ?? null, merged: 0 });
    return;
  }

  const carts = req.scope.resolve<ICartModuleService>(Modules.CART);
  let merged = 0;
  for (const other of open.slice(0, MAX_MERGED_CARTS)) {
    const items = (other.items ?? [])
      .filter((item): item is { variant_id: string; quantity: unknown } => Boolean(item?.variant_id))
      .map((item) => ({ variant_id: item.variant_id, quantity: Number(item.quantity) || 1 }));
    if (items.length > 0) {
      try {
        await addToCartWorkflow(req.scope).run({ input: { cart_id: current.id, items } });
        merged += items.length;
      } catch (error) {
        fail(`merge from ${other.id}`, error);
        continue;
      }
    }
    await carts
      .updateCarts(other.id, { metadata: { ...(other.metadata ?? {}), [MERGED_KEY]: current.id } })
      .catch((error: unknown) => fail(`mark ${other.id}`, error));
  }

  res.json({ cartId: current.id, merged });
}
