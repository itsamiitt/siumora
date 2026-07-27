"use server";

import { revalidatePath } from "next/cache";

import type {
  NdrAction,
  NdrReason,
  OrderStatus,
  ReturnReason,
  ReturnResolution,
} from "@siumora/core";

import { advanceOrder, resolveNdr } from "@/lib/order-store";
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
  ndrReason?: NdrReason,
): Promise<ActionResult> {
  const result = await advanceOrder(orderNumber, to, ndrReason);
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

/**
 * Record the customer's answer to a failed delivery.
 *
 * WhatsApp buttons drive this in production; the on-site control is the same
 * three choices, and the same state change.
 */
export async function answerNdr(
  orderNumber: string,
  action: NdrAction,
): Promise<ActionResult> {
  const result = await resolveNdr(orderNumber, action);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath(`/orders/${orderNumber}`);
  revalidatePath("/account");
  return { ok: true };
}
