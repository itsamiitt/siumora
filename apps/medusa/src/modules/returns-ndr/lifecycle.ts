/**
 * Pure returns/NDR lifecycle logic — no Medusa imports, so node --test can
 * strip-type it (same convention as siumora-order/identity.ts). Everything
 * the routes decide that is worth a unit test lives here; the routes stay
 * thin I/O.
 *
 * The state machine itself is @siumora/core's — canTransition, ndrState,
 * outcomeFor, evaluateReturn. This file only arranges core's answers into
 * the refusal envelopes the Fastify routes word them as
 * (apps/api/src/routes/orders.ts), so parity is a wording concern here and
 * a logic concern in core, where it is already tested.
 */

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { NDR_REASON_LABELS, ORDER_STATUSES, RETURN_REASON_LABELS, canTransition, evaluateReturn, ndrState, outcomeFor, type NdrAction, type NdrReason, type OrderStatus, type ReturnReason, type ReturnResolution } from "@siumora/core";

export type { NdrAction, NdrReason, OrderStatus, ReturnReason, ReturnResolution };

/** A refusal, shaped exactly like the Fastify error envelopes. */
export interface Refusal {
  readonly ok: false;
  readonly code: 400 | 403 | 409;
  readonly error: string;
  readonly message: string;
}

// ── Courier-simulation gate ───────────────────────────────────

/**
 * Mirror of apps/api/src/server.ts: COURIER_SIMULATION === "true" switches it
 * on, unset means on outside production, anything else is off. Production is
 * hard-off here regardless of the env value — the Fastify stack refuses to
 * BOOT with an explicit COURIER_SIMULATION=true in production
 * (assertBootSafety); the equivalent boot guard belongs to boot-guards.ts,
 * which is owned elsewhere (see REGISTER.md), so until it lands this helper
 * fails closed rather than open.
 */
export function courierSimulationEnabled(env: {
  COURIER_SIMULATION?: string;
  APP_ENV?: string;
}): boolean {
  const appEnv = env.APP_ENV ?? "development";
  if (appEnv === "production") return false;
  return env.COURIER_SIMULATION === "true" || env.COURIER_SIMULATION === undefined;
}

/** The 403 the Fastify status route sends when neither operator nor simulation. */
export const SIMULATION_REFUSAL: Refusal = {
  ok: false,
  code: 403,
  error: "not_an_operator",
  message: "Only the courier or an operator can move this order.",
};

// ── Vocabulary (runtime lists, pinned against core in tests) ──

/**
 * The statuses a courier walk may request — the Fastify status route's zod
 * enum: every core status except the two pre-placement ones, which only the
 * payment webhooks may set.
 */
export const WALKABLE_STATUSES: readonly OrderStatus[] = ORDER_STATUSES.filter(
  (status: OrderStatus) =>
    status !== "pending_payment" && status !== "awaiting_cod_confirmation",
);

export const NDR_REASONS = Object.keys(NDR_REASON_LABELS) as readonly NdrReason[];
export const RETURN_REASONS = Object.keys(RETURN_REASON_LABELS) as readonly ReturnReason[];
export const RETURN_RESOLUTIONS: readonly ReturnResolution[] = ["refund", "exchange"];
export const NDR_ACTIONS: readonly NdrAction[] = ["reattempt", "update_address", "cancel"];

/**
 * The status the lazy-inserted status row starts from, seeded off Medusa's
 * own order status. Deliberately the same confirmed-unless-cancelled mapping
 * the sibling order read uses (siumora-order/identity.ts siumoraOrderStatus)
 * — held here, in this module, because this module owns the richer statuses:
 * once the row exists, the ROW is the status truth and Medusa's order.status
 * is never consulted again (Medusa's fulfillment statuses arrive with real
 * couriers in M3).
 */
export function initialSiumoraStatus(medusaStatus: string): OrderStatus {
  return medusaStatus === "canceled" ? "cancelled" : "confirmed";
}

// ── Body parsing (hand-rolled: this app has no zod dependency) ─

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface StatusBody {
  status: OrderStatus;
  ndrReason?: NdrReason;
}

export function parseStatusBody(body: unknown): Parsed<StatusBody> {
  if (!isRecord(body)) return { ok: false, message: "body: expected an object" };
  const status = body.status;
  if (typeof status !== "string" || !(WALKABLE_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, message: `status: expected one of ${WALKABLE_STATUSES.join("|")}` };
  }
  const ndrReason = body.ndrReason;
  if (ndrReason !== undefined) {
    if (typeof ndrReason !== "string" || !(NDR_REASONS as readonly string[]).includes(ndrReason)) {
      return { ok: false, message: `ndrReason: expected one of ${NDR_REASONS.join("|")}` };
    }
  }
  return {
    ok: true,
    value: {
      status: status as OrderStatus,
      ...(ndrReason !== undefined ? { ndrReason: ndrReason as NdrReason } : {}),
    },
  };
}

export function parseNdrBody(body: unknown): Parsed<{ action: NdrAction }> {
  if (!isRecord(body)) return { ok: false, message: "body: expected an object" };
  const action = body.action;
  if (typeof action !== "string" || !(NDR_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, message: `action: expected one of ${NDR_ACTIONS.join("|")}` };
  }
  return { ok: true, value: { action: action as NdrAction } };
}

export interface ReturnBody {
  variantIds: string[];
  reason: ReturnReason;
  resolution: ReturnResolution;
  sealIntact?: boolean;
  note?: string;
}

/**
 * The Fastify body schema, minus one deliberate difference: variantIds are
 * non-empty strings rather than z.uuid(), because Medusa variant ids are
 * "variant_…"-prefixed, not UUIDs. Everything else — min 1 id, the reason
 * and resolution enums, optional boolean sealIntact, note ≤ 1000 — matches.
 */
export function parseReturnBody(body: unknown): Parsed<ReturnBody> {
  if (!isRecord(body)) return { ok: false, message: "body: expected an object" };
  const variantIds = body.variantIds;
  if (
    !Array.isArray(variantIds) ||
    variantIds.length === 0 ||
    variantIds.some((id) => typeof id !== "string" || id.length === 0)
  ) {
    return { ok: false, message: "variantIds: expected a non-empty array of variant ids" };
  }
  const reason = body.reason;
  if (typeof reason !== "string" || !(RETURN_REASONS as readonly string[]).includes(reason)) {
    return { ok: false, message: `reason: expected one of ${RETURN_REASONS.join("|")}` };
  }
  const resolution = body.resolution;
  if (
    typeof resolution !== "string" ||
    !(RETURN_RESOLUTIONS as readonly string[]).includes(resolution)
  ) {
    return { ok: false, message: `resolution: expected one of ${RETURN_RESOLUTIONS.join("|")}` };
  }
  if (body.sealIntact !== undefined && typeof body.sealIntact !== "boolean") {
    return { ok: false, message: "sealIntact: expected a boolean" };
  }
  if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 1000)) {
    return { ok: false, message: "note: expected a string of at most 1000 characters" };
  }
  return {
    ok: true,
    value: {
      variantIds: variantIds as string[],
      reason: reason as ReturnReason,
      resolution: resolution as ReturnResolution,
      ...(body.sealIntact !== undefined ? { sealIntact: body.sealIntact } : {}),
      ...(body.note !== undefined ? { note: body.note as string } : {}),
    },
  };
}

// ── Confirm ───────────────────────────────────────────────────

/**
 * COD confirms at placement, so the reachable answer today is the 409 the
 * contract suite pins (sdk-contract.test.ts: "confirmOrder … must refuse
 * identically"). The legal arms (pending_payment / awaiting_cod_confirmation
 * → confirmed) are decided by core exactly as Fastify does, so the M3
 * Razorpay and COD-verification ports inherit a working gate.
 */
export function decideConfirm(current: OrderStatus): { ok: true } | Refusal {
  if (!canTransition(current, "confirmed")) {
    return {
      ok: false,
      code: 409,
      error: "illegal_transition",
      message: `Cannot confirm an order that is ${current}.`,
    };
  }
  return { ok: true };
}

// ── The courier walk (Fastify's advance(), decided purely) ────

export type AdvanceDecision =
  | Refusal
  | {
      readonly ok: true;
      /** What to write — ndr collapses to rto when unrecoverable. */
      readonly status: OrderStatus;
      readonly deliveryAttempts: number;
      readonly ndrReason: NdrReason | null;
      /** True when an NDR event row must be recorded. */
      readonly recordNdr: boolean;
    };

export function decideAdvance(
  from: OrderStatus,
  to: OrderStatus,
  priorAttempts: number,
  requestedNdrReason: NdrReason | undefined,
  storedNdrReason: string | null,
): AdvanceDecision {
  if (!canTransition(from, to)) {
    return {
      ok: false,
      code: 409,
      error: "illegal_transition",
      message: `Cannot move from ${from} to ${to}.`,
    };
  }

  const attempts = to === "ndr" ? priorAttempts + 1 : priorAttempts;
  const reason =
    to === "ndr"
      ? (requestedNdrReason ?? (storedNdrReason as NdrReason | null) ?? "customer_unavailable")
      : (storedNdrReason as NdrReason | null);

  // An attempt that cannot be recovered continues straight to RTO, so the
  // stored status never says "delivery attempted" on a parcel already
  // travelling back — same collapse as Fastify's advance().
  let status: OrderStatus = to;
  if (to === "ndr" && outcomeFor(attempts, reason as NdrReason) === "rto") {
    status = "rto";
  }

  return {
    ok: true,
    status,
    deliveryAttempts: attempts,
    ndrReason: reason,
    recordNdr: to === "ndr",
  };
}

// ── The customer's NDR answer ─────────────────────────────────

export type NdrAnswerDecision =
  | Refusal
  | { readonly ok: true; readonly target: "cancelled" | "out_for_delivery" };

export function decideNdrAnswer(
  current: string,
  action: NdrAction,
  attempts: number,
  storedReason: string | null,
): NdrAnswerDecision {
  if (current !== "ndr") {
    return {
      ok: false,
      code: 409,
      error: "not_awaiting_answer",
      message: "This order is not in NDR.",
    };
  }

  if (action === "cancel") return { ok: true, target: "cancelled" };

  const state = ndrState(attempts, (storedReason ?? "customer_unavailable") as NdrReason);
  if (!state.recoverable) {
    return {
      ok: false,
      code: 409,
      error: "not_recoverable",
      message: "The courier cannot attempt this delivery again.",
    };
  }

  return { ok: true, target: "out_for_delivery" };
}

// ── Returns ───────────────────────────────────────────────────

export interface ReturnLine {
  readonly variantId: string;
  readonly piercedJewellery: boolean;
}

export type ReturnDecision =
  | Refusal
  | {
      readonly ok: true;
      readonly insert: {
        readonly status: "approved";
        readonly refundTo: string;
        readonly freeReturnShipping: boolean;
      };
    };

export function decideReturn(input: {
  orderStatus: OrderStatus;
  deliveredAt: Date;
  now: Date;
  lines: readonly ReturnLine[];
  body: ReturnBody;
  paymentMethod: "cod" | "upi";
}): ReturnDecision {
  const chosen = input.lines.filter((line) =>
    input.body.variantIds.includes(line.variantId),
  );
  if (chosen.length === 0) {
    return {
      ok: false,
      code: 400,
      error: "not_on_order",
      message: "Those pieces are not on this order.",
    };
  }

  const eligibility = evaluateReturn({
    orderStatus: input.orderStatus,
    deliveredAt: input.deliveredAt,
    now: input.now,
    reason: input.body.reason,
    // Judged against the strictest piece: one pierced item makes the hygiene
    // rule apply to the whole request — same rule as the Fastify route.
    isPiercedJewellery: chosen.some((line) => line.piercedJewellery),
    sealIntact: input.body.sealIntact,
    paymentMethod: input.paymentMethod,
  });

  if (!eligibility.eligible) {
    return {
      ok: false,
      code: 409,
      error: "not_eligible",
      message: eligibility.refusal ?? "This return is not eligible.",
    };
  }

  // Auto-approve exactly where Fastify auto-approves: every eligible request
  // is inserted as "approved" (core's evaluateReturn carries autoApproved).
  return {
    ok: true,
    insert: {
      status: "approved",
      refundTo: eligibility.refundTo ?? "original_payment_method",
      freeReturnShipping: eligibility.freeReturnShipping,
    },
  };
}

// ── Envelopes ─────────────────────────────────────────────────

/** {ok, order} — the Fastify confirm/status/ndr success envelope. */
export function orderEnvelope(
  orderNumber: string,
  status: string,
  deliveryAttempts: number,
  ndrReason: string | null,
): {
  ok: true;
  order: { number: string; status: string; deliveryAttempts: number; ndrReason: string | null };
} {
  return {
    ok: true,
    order: { number: orderNumber, status, deliveryAttempts, ndrReason },
  };
}

/** The stored return-request row, as data.ts reads it back. */
export interface ReturnRow {
  id: string;
  order_id: string;
  status: string;
  reason: string;
  resolution: string;
  variant_ids: unknown;
  refund_to: string;
  free_return_shipping: boolean;
  seal_intact: boolean | null;
  note: string | null;
  created_at: string | Date;
}

/**
 * {ok, return, reversePickup} — the recorded requestReturn contract
 * (sdk-contract.test.ts pins exactly these three keys).
 *
 * reversePickup is null until the M3 Shiprocket port books real reverse
 * pickups. Noted for honesty: the Fastify route with no courier configured
 * answers the STRING "not_booked" here, while the SDK return type is
 * `Record | null` — null is the value that satisfies the typed transport
 * contract, and the M3 booking object replaces it.
 */
export function returnEnvelope(row: ReturnRow): {
  ok: true;
  return: {
    id: string;
    orderId: string;
    variantIds: unknown;
    reason: string;
    resolution: string;
    status: string;
    refundTo: string;
    freeReturnShipping: boolean;
    sealIntact: boolean | null;
    note: string | null;
    createdAt: string | Date;
  };
  reversePickup: null;
} {
  return {
    ok: true,
    return: {
      id: row.id,
      orderId: row.order_id,
      variantIds: row.variant_ids,
      reason: row.reason,
      resolution: row.resolution,
      status: row.status,
      refundTo: row.refund_to,
      freeReturnShipping: row.free_return_shipping,
      sealIntact: row.seal_intact,
      note: row.note,
      createdAt: row.created_at,
    },
    reversePickup: null,
  };
}
