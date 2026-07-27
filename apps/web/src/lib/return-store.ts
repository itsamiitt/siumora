import "server-only";

import type { ReturnReason, ReturnResolution, RmaStatus } from "@siumora/core";

import { api } from "./api";

/**
 * Returns.
 *
 * Eligibility is decided by the API from the order's real delivery date and
 * the pieces actually on it — never from anything the browser sends.
 */

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
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await api().requestReturn(input.orderNumber, {
      variantIds: [...input.variantIds],
      reason: input.reason,
      resolution: input.resolution,
      ...(input.sealIntact !== undefined ? { sealIntact: input.sealIntact } : {}),
      ...(input.note ? { note: input.note } : {}),
    });
    return { ok: true };
  } catch (error) {
    // The API's message is the useful one — it names the hygiene rule or the
    // closed window rather than a status code.
    return {
      ok: false,
      message:
        error instanceof Error && error.message
          ? error.message
          : "Could not start the return.",
    };
  }
}

export interface OpenReturn {
  readonly id: string;
  readonly status: RmaStatus;
  readonly reason: ReturnReason;
  readonly resolution: ReturnResolution;
  readonly refundTo: "original_payment_method" | "upi";
  readonly freeReturnShipping: boolean;
}

/**
 * The open return on an order, typed.
 *
 * The API returns a plain row, so the shape is narrowed here rather than cast
 * at each render site — a page should not have to know the wire format.
 */
export async function getReturnForOrder(
  orderNumber: string,
): Promise<OpenReturn | undefined> {
  const result = await api().getOrder(orderNumber);
  const row = result?.return;
  if (!row) return undefined;

  return {
    id: row.id as string,
    status: row.status as RmaStatus,
    reason: row.reason as ReturnReason,
    resolution: row.resolution as ReturnResolution,
    refundTo: row.refundTo as OpenReturn["refundTo"],
    freeReturnShipping: Boolean(row.freeReturnShipping),
  };
}
