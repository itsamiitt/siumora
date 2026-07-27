import "server-only";

import {
  evaluateReturn,
  type ReturnReason,
  type ReturnRequest,
  type ReturnResolution,
} from "@siumora/core";

import { getOrder } from "./order-store";

/**
 * Return requests.
 *
 * Same global-slot arrangement as the cart and orders — a plain module constant
 * is instantiated more than once across Next's bundles.
 */

const globalForReturns = globalThis as typeof globalThis & {
  __siumoraReturns?: Map<string, ReturnRequest>;
};

const RETURNS: Map<string, ReturnRequest> = (globalForReturns.__siumoraReturns ??=
  new Map());

export interface StartReturnInput {
  readonly orderNumber: string;
  readonly variantIds: readonly string[];
  readonly reason: ReturnReason;
  readonly resolution: ReturnResolution;
  readonly sealIntact?: boolean;
  readonly note?: string;
}

export async function startReturn(
  input: StartReturnInput,
): Promise<{ ok: true; request: ReturnRequest } | { ok: false; message: string }> {
  const order = await getOrder(input.orderNumber);
  if (!order) return { ok: false, message: "Order not found." };

  if (input.variantIds.length === 0) {
    return { ok: false, message: "Choose at least one piece to return." };
  }

  const lines = order.lines.filter((line) =>
    input.variantIds.includes(line.variantId),
  );
  if (lines.length === 0) {
    return { ok: false, message: "Those pieces are not on this order." };
  }

  // Eligibility is judged against the strictest piece being returned: if any
  // one of them is pierced jewellery, the hygiene rule applies to the request.
  const eligibility = evaluateReturn({
    orderStatus: order.status,
    deliveredAt: new Date(order.deliveredAt ?? order.placedAt),
    now: new Date(),
    reason: input.reason,
    isPiercedJewellery: lines.some((line) => line.piercedJewellery),
    sealIntact: input.sealIntact,
    paymentMethod: order.paymentMethod,
  });

  if (!eligibility.eligible) {
    return { ok: false, message: eligibility.refusal ?? "Not eligible." };
  }

  const existing = [...RETURNS.values()].find(
    (r) => r.orderNumber === input.orderNumber && r.status !== "rejected",
  );
  if (existing) {
    return { ok: false, message: "A return is already open on this order." };
  }

  const request: ReturnRequest = {
    id: crypto.randomUUID(),
    orderNumber: input.orderNumber,
    variantIds: [...input.variantIds],
    reason: input.reason,
    resolution: input.resolution,
    ...(input.note ? { note: input.note } : {}),
    // The policy auto-approves inside the window; a human only sees it if the
    // piece fails the quality check on arrival.
    status: "approved",
    refundTo: eligibility.refundTo ?? "original_payment_method",
    freeReturnShipping: eligibility.freeReturnShipping,
    createdAt: new Date().toISOString(),
  };

  RETURNS.set(request.id, request);
  return { ok: true, request };
}

export async function getReturnForOrder(
  orderNumber: string,
): Promise<ReturnRequest | undefined> {
  return [...RETURNS.values()].find((r) => r.orderNumber === orderNumber);
}
