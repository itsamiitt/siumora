/**
 * Guards on Medusa's native store cart and payment routes (security review,
 * items 1 and 10). The Siumora checkout routes are where money is decided —
 * the COD gate, fee and serviceability (complete), the Razorpay order
 * (prepare), the coupon guessing ceiling (coupons). Medusa's own doors to
 * the same outcomes stay open by default, so these close or narrow them:
 *
 * - POST /store/carts/:id/complete — closed. Native completion with a
 *   system-provider session places a COD order with no OTP, no fee and no
 *   serviceability check. Orders complete through
 *   /store/siumora/carts/:id/complete only.
 * - POST /store/payment-collections/:id/payment-sessions — refused for the
 *   system (COD) provider. That session is opened server-side by the
 *   complete route after its gates; a shopper opening one is the first half
 *   of the bypass above.
 * - POST /store/carts and /store/carts/:id — `promo_codes` refused (coupons
 *   go through /store/siumora/coupons and its strict ceiling), and
 *   server-owned `siumora_*` metadata keys refused. The storefront writes
 *   its analytics keys and the gift message there (SDK setCartAddress), so
 *   those few pass; anything else under the prefix is the server's to write
 *   (the payment method above all). Refused rather than stripped: whether
 *   this runs before or after Medusa's body validator copies req.body, a
 *   400 stops the write either way.
 *
 * Structural types, no @medusajs imports: runnable under node --test.
 */

import { SYSTEM_PROVIDER_ID } from "../modules/siumora-order/payment-method.ts";

/** The `siumora_*` cart metadata keys the storefront writes itself. */
export const SHOPPER_METADATA_KEYS: ReadonlySet<string> = new Set([
  "siumora_event_id",
  "siumora_ga_client_id",
  "siumora_consent",
  // The server tidies and bounds it at readyCart (plan 16 B21).
  "siumora_gift_message",
]);

const SERVER_PREFIX = "siumora_";

export interface GuardRequest {
  method: string;
  body?: unknown;
}

export interface GuardResponse {
  status(code: number): { json(body: unknown): unknown };
}

export type GuardNext = (err?: unknown) => void;

/** The server-owned `siumora_*` keys in a metadata write, if any. */
export function serverOwnedKeys(metadata: unknown): string[] {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  return Object.keys(metadata).filter(
    (key) => key.startsWith(SERVER_PREFIX) && !SHOPPER_METADATA_KEYS.has(key),
  );
}

/** Middleware on native POST /store/carts and POST /store/carts/:id. */
export function guardNativeCartWrite(req: GuardRequest, res: GuardResponse, next: GuardNext): void {
  if (req.method !== "POST") return next();
  const body = req.body;
  if (body === null || typeof body !== "object") return next();
  const record = body as Record<string, unknown>;
  if ("promo_codes" in record) {
    res.status(400).json({
      error: "field_not_editable",
      message: "Apply coupons through /store/siumora/coupons.",
    });
    return;
  }
  const owned = serverOwnedKeys(record.metadata);
  if (owned.length > 0) {
    res.status(400).json({
      error: "field_not_editable",
      message: `These can't be set here: ${owned.map((key) => `metadata.${key}`).join(", ")}.`,
    });
    return;
  }
  next();
}

/** Native cart completion: closed — see the file comment. */
export function closedNativeCompletion(_req: GuardRequest, res: GuardResponse): void {
  res.status(404).json({
    error: "not_found",
    message: "Place orders through /store/siumora/carts/:id/complete.",
  });
}

/** Native payment-session creation: never for the system (COD) provider. */
export function guardPaymentSessionCreate(req: GuardRequest, res: GuardResponse, next: GuardNext): void {
  if (req.method !== "POST") return next();
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (body.provider_id === SYSTEM_PROVIDER_ID) {
    res.status(404).json({
      error: "not_found",
      message: "Cash on delivery is chosen at /store/siumora/carts/:id/complete.",
    });
    return;
  }
  next();
}
