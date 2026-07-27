"use server";

import { revalidatePath } from "next/cache";

import type { OrderStatus, ReturnReason, ReturnResolution } from "@siumora/core";

import { advanceOrder } from "@/lib/order-store";
import { startReturn } from "@/lib/return-store";

export interface ActionResult {
  ok: boolean;
  message?: string;
}

/**
 * Move an order along its lifecycle.
 *
 * Stands in for the courier webhook. Kept as a server action rather than a
 * client-side mutation so the transition still passes through the same
 * validation the real webhook would.
 */
export async function advanceOrderStatus(
  orderNumber: string,
  to: OrderStatus,
): Promise<ActionResult> {
  const result = await advanceOrder(orderNumber, to);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(`/orders/${orderNumber}`);
  revalidatePath("/account");
  return { ok: true };
}

export async function requestReturn(input: {
  orderNumber: string;
  variantIds: string[];
  reason: ReturnReason;
  resolution: ReturnResolution;
  sealIntact?: boolean;
  note?: string;
}): Promise<ActionResult> {
  const result = await startReturn(input);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(`/orders/${input.orderNumber}`);
  return { ok: true };
}
