/**
 * Pure serviceability + quote logic — the decisions the two routes make,
 * kept out of the route files so node --test can strip-type them (same
 * convention as siumora-order/identity.ts; the routes stay thin I/O).
 *
 * The parity bar is the Fastify pair:
 * - GET /pincodes/:pincode        (apps/api/src/routes/catalog.ts)
 * - POST /checkout/quote          (apps/api/src/routes/checkout.ts)
 * and the recorded contract (apps/api/src/sdk-contract.test.ts) pins both
 * envelopes key-for-key. The risk engines are IMPORTED from @siumora/core,
 * not copied — the quote is parity by construction, the same scoreAddress /
 * scoreRto / evaluateCod the Fastify route runs, over the same paise.
 */

// Runtime: the M0 dist refactor's require condition (dist/*.cjs). The
// @ts-ignore mutes TS1479 (ESM-flavored types on a require import) — a
// packages/* exports-map concern shared app-wide, not a runtime one.
// prettier-ignore -- single line so @ts-ignore reaches the specifier
// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { evaluateCod, scoreAddress, scoreRto, type AddressQuality, type CodDecision, type RtoRisk } from "@siumora/core";

/**
 * The pincode shape both Fastify routes enforce through zod:
 * z.string().regex(/^[1-9]\d{5}$/) — six digits, never a leading zero.
 * packages/in-locale's PINCODE_PATTERN is the same expression (it also
 * trims; the routes do not, and this mirrors the routes). A value that
 * fails this is the caller's mistake: the 400 invalid_request arm, never
 * a lookup.
 */
const PINCODE_RE = /^[1-9]\d{5}$/;

export function isWellFormedPincode(value: string): boolean {
  return PINCODE_RE.test(value);
}

/** GST state codes are two digits on the wire (Fastify: /^\d{2}$/). */
const STATE_CODE_RE = /^\d{2}$/;

/**
 * The serviceability row off the wire — snake_case, exactly the columns of
 * siumora_pincode_serviceability (which mirror packages/db's
 * pincode_serviceability).
 */
export interface PincodeRow {
  pincode: string;
  city: string;
  state_code: string;
  serviceable: boolean;
  cod_available: boolean;
  estimated_days: string;
  rto_rate_bps: number;
}

/**
 * What the Fastify route answers for a pincode the courier has not told us
 * about — copied verbatim (an em dash, deliberately the same character).
 */
export const UNKNOWN_ESTIMATED_DAYS = "—";

/**
 * The pincode card, shaped to the recorded contract: a KNOWN pincode is the
 * full seven-key row (camelCase, as drizzle serves it on the Fastify side);
 * an UNKNOWN one is not an error — it is simply one the courier has not
 * told us about, and it must not be reported as serviceable. The unknown
 * envelope carries no city/stateCode, exactly like Fastify's literal.
 */
export function pincodeCard(
  pincode: string,
  row: PincodeRow | undefined,
):
  | {
      pincode: string;
      city: string;
      stateCode: string;
      serviceable: boolean;
      codAvailable: boolean;
      estimatedDays: string;
      rtoRateBps: number;
    }
  | {
      pincode: string;
      serviceable: false;
      codAvailable: false;
      estimatedDays: string;
      rtoRateBps: 0;
    } {
  if (!row) {
    return {
      pincode,
      serviceable: false,
      codAvailable: false,
      estimatedDays: UNKNOWN_ESTIMATED_DAYS,
      rtoRateBps: 0,
    };
  }
  return {
    pincode: row.pincode,
    city: row.city,
    stateCode: row.state_code,
    serviceable: row.serviceable,
    codAvailable: row.cod_available,
    estimatedDays: row.estimated_days,
    rtoRateBps: row.rto_rate_bps,
  };
}

/**
 * What a shopper's history contributes to the risk picture — the Medusa
 * mirror of Fastify's customerSignals (apps/api/src/routes/checkout.ts).
 * Anonymous is exactly the Fastify no-viewer arm.
 */
export interface QuoteSignals {
  phoneVerified: boolean;
  isNewCustomer: boolean;
  successfulOrders: number;
}

export const ANONYMOUS_SIGNALS: QuoteSignals = {
  phoneVerified: false,
  isNewCustomer: true,
  successfulOrders: 0,
};

/** The COD dial values the quote hands to core's evaluateCod. */
export interface CodLimits {
  minOrder: number;
  maxOrder: number;
  fee: number;
}

/** The quote body, mirroring the Fastify zod schema field-for-field. */
export interface QuoteBody {
  cartId: string;
  pincode: string;
  address?: string | undefined;
  city?: string | undefined;
  stateCode?: string | undefined;
  phone?: string | undefined;
}

/**
 * Validate the quote body the way the Fastify zod schema does, producing
 * the same 400 material: every failed field as "field: problem", joined by
 * "; " and capped at 500 chars (apps/api/src/app.ts setErrorHandler).
 *
 * One deliberate deviation: Fastify's cartId is z.uuid() because its cart
 * ids are uuids; Medusa cart ids are "cart_…" strings, so the shape check
 * here is presence + type + length — the id format belongs to the backend,
 * the refusal-of-garbage behavior is the contract.
 */
export function parseQuoteBody(
  body: unknown,
): { ok: true; value: QuoteBody } | { ok: false; message: string } {
  const issues: string[] = [];
  const record: Record<string, unknown> =
    body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};

  const cartId = record.cartId;
  if (typeof cartId !== "string" || cartId.length === 0 || cartId.length > 255) {
    issues.push("cartId: expected a cart id");
  }
  const pincode = record.pincode;
  if (typeof pincode !== "string" || !isWellFormedPincode(pincode)) {
    issues.push("pincode: expected a six-digit Indian pincode");
  }

  const optionalString = (
    field: "address" | "city" | "stateCode" | "phone",
    max: number,
    pattern?: RegExp,
    problem?: string,
  ): string | undefined => {
    const value = record[field];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.length > max || (pattern && !pattern.test(value))) {
      issues.push(`${field}: ${problem ?? `expected a string of at most ${max} characters`}`);
      return undefined;
    }
    return value;
  };

  // Same caps as the Fastify schema: address 300, city 120, phone 20.
  const address = optionalString("address", 300);
  const city = optionalString("city", 120);
  const stateCode = optionalString(
    "stateCode",
    2,
    STATE_CODE_RE,
    "expected a two-digit GST state code",
  );
  const phone = optionalString("phone", 20);

  if (issues.length > 0) {
    return { ok: false, message: issues.join("; ").slice(0, 500) };
  }
  return {
    ok: true,
    // Rebuilt field-by-field: unknown keys are dropped, the way zod's
    // .object() strips them.
    value: {
      cartId: cartId as string,
      pincode: pincode as string,
      address,
      city,
      stateCode,
      phone,
    },
  };
}

/** Everything the quote decision needs, gathered by the route. */
export interface QuoteInput {
  body: QuoteBody;
  /** The serviceability row, when the pincode is known. */
  row: PincodeRow | undefined;
  /** Cart subtotal in integer paise (unitPrice × quantity over the lines). */
  subtotalPaise: number;
  signals: QuoteSignals;
  /** The COD dial (settings module when present, else its defaults). */
  limits: CodLimits;
}

/**
 * The quote envelope, exactly the Fastify /checkout/quote return — the
 * recorded contract pins the keys: serviceable, estimatedDays,
 * addressQuality{score,issues,needsReview}, rto{risk,score}, cod,
 * phoneVerified. Every sub-shape comes straight out of core's engines, the
 * same functions the Fastify route calls, in the same order, over the same
 * inputs.
 */
export function computeQuote(input: QuoteInput): {
  serviceable: boolean;
  estimatedDays: string;
  addressQuality: AddressQuality;
  rto: { risk: RtoRisk; score: number };
  cod: CodDecision;
  phoneVerified: boolean;
} {
  const { body, row, signals } = input;

  const quality = scoreAddress({
    line1: body.address ?? "",
    city: body.city ?? "",
    stateCode: body.stateCode ?? "",
    pincode: body.pincode,
  });

  const risk = scoreRto({
    paymentMethod: "cod",
    orderValue: input.subtotalPaise,
    addressScore: quality.score,
    phoneVerified: signals.phoneVerified,
    isNewCustomer: signals.isNewCustomer,
    pincodeRtoRate: row ? row.rto_rate_bps / 10_000 : undefined,
  });

  const cod = evaluateCod({
    subtotal: input.subtotalPaise,
    pincodeCodServiceable: row?.cod_available ?? false,
    rtoRisk: risk.risk,
    successfulOrders: signals.successfulOrders,
    limits: input.limits,
  });

  return {
    serviceable: row?.serviceable ?? false,
    estimatedDays: row?.estimated_days ?? UNKNOWN_ESTIMATED_DAYS,
    addressQuality: quality,
    rto: { risk: risk.risk, score: risk.score },
    cod,
    // Told to the storefront so it can explain why the terms differ, rather
    // than a fee that silently appears or disappears between visits.
    phoneVerified: signals.phoneVerified,
  };
}
