/**
 * Pure identity logic — no Medusa imports, so node --test can strip-type it
 * (same convention as boot-guards.ts). Everything the routes decide that is
 * worth a unit test lives here; the routes stay thin I/O.
 */

/**
 * The status a COD order holds the moment it is placed.
 *
 * This is @siumora/core's initialStatus("cod", { requiresCodConfirmation:
 * false }) — held as a constant rather than an import because this app
 * typechecks as CJS and core's static surface is ESM; identity.test.ts pins
 * the value against core itself (dynamic import), so drift is a failing
 * test, not a quiet fork. The COD verification hold ("awaiting_cod_
 * confirmation") arrives with the risk/quote port, not this route.
 */
export const PLACED_STATUS = "confirmed";

/**
 * The order-number format, mirrored from @siumora/core's orderNumber().
 *
 * Mirrored rather than imported for one reason: the authoritative formatting
 * happens in SQL (allocate.ts builds the number inside the INSERT so the
 * sequence draw and the row are one atomic statement), and this JS mirror
 * exists to let the unit tests prove the SQL expression and core's
 * orderNumber() agree. identity.test.ts pins both against @siumora/core.
 */
export function formatOrderNumber(sequence: number): string {
  return `SIU-${String(sequence).padStart(5, "0")}`;
}

/** The SQL twin of formatOrderNumber, used inside the allocation INSERT. */
export const ORDER_NUMBER_SQL =
  "'SIU-' || lpad(nextval('siumora_order_number_seq')::text, 5, '0')";

/**
 * Access-key shape check — the 400/404 fork of the recorded contract
 * (apps/api/src/sdk-contract.test.ts): a MALFORMED key (not a uuid) is a 400
 * invalid_request; a wrong-but-well-formed key is a 404. The Fastify side
 * gets this from zod's z.uuid(); this regex accepts the same values
 * (RFC 4122-shaped, case-insensitive).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isWellFormedAccessKey(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Medusa major units (rupees) → canonical integer paise.
 *
 * Same contract as packages/sdk/src/medusa.ts majorToPaise: throws rather
 * than rounds, because an amount that is not a whole paise value means the
 * data went through a float somewhere — a bug to surface, not smooth over.
 */
export function majorToPaise(amount: number): number {
  const paise = Math.round(amount * 100);
  if (!Number.isFinite(amount) || Math.abs(amount * 100 - paise) > 1e-6) {
    throw new Error(`Medusa amount ${amount} does not convert to integer paise`);
  }
  return paise;
}

/**
 * A numeric off the query.graph wire.
 *
 * Money fields (unit_price, shipping_total) arrive as Medusa BigNumber
 * objects, not JS numbers — feeding one to arithmetic yields NaN and a 500
 * where an order card should be. Their toJSON() is the plain number, so the
 * JSON round-trip is the sanctioned unwrap; anything that still is not a
 * finite number afterwards throws with the field's name, keeping
 * majorToPaise's refuse-don't-round contract intact.
 */
export function wireNumber(value: unknown, field: string): number {
  const unwrapped =
    typeof value === "number" ? value : JSON.parse(JSON.stringify(value ?? 0));
  if (typeof unwrapped !== "number" || !Number.isFinite(unwrapped)) {
    throw new Error(`${field} is not numeric on the wire: ${JSON.stringify(value)}`);
  }
  return unwrapped;
}

function metadataPaise(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/** The slice of a Medusa order line the money mapping reads. unit_price is
 * `unknown` deliberately: query.graph serves it as a BigNumber object, and
 * wireNumber is the one sanctioned unwrap. */
export interface OrderLineWire {
  quantity: number;
  unit_price: unknown;
  variant?: {
    metadata?: { mrp_paise?: unknown; price_paise?: unknown } | null;
  } | null;
}

/**
 * Integer paise for an order line, the same way the transport reads them
 * (packages/sdk/src/medusa.ts variantPrice): the seed's lossless
 * `price_paise`/`mrp_paise` metadata first, Medusa's major-unit amount × 100
 * only as the fallback, and a variant without an MRP is priced at MRP.
 */
export function linePaise(line: OrderLineWire): { unitPrice: number; mrp: number } {
  const metadata = line.variant?.metadata ?? {};
  const unitPrice =
    metadataPaise(metadata.price_paise) ??
    majorToPaise(wireNumber(line.unit_price, "unit_price"));
  const mrp = metadataPaise(metadata.mrp_paise) ?? unitPrice;
  return { unitPrice, mrp };
}

/**
 * Medusa order status → the Siumora status vocabulary the storefront's state
 * machine (core's canTransition) speaks.
 *
 * Deliberately narrow: the only orders this Medusa app can hold today came
 * through the COD complete route, and a COD order that needed no
 * verification is "confirmed" at placement (core's initialStatus — the same
 * value the Fastify contract records). Medusa's fulfillment-driven statuses
 * (processing/shipped/…) arrive with the M2 ops port; until then the honest
 * mapping is confirmed-unless-cancelled.
 */
export function siumoraOrderStatus(medusaStatus: string): string {
  return medusaStatus === "canceled" ? "cancelled" : "confirmed";
}

/** The row shape allocate.ts returns — mirrored here so envelopes stay pure. */
export interface IdentityRow {
  id: string;
  order_id: string;
  cart_id: string | null;
  order_number: string;
  access_key: string;
  idempotency_key: string | null;
  created_at: string | Date;
}

/**
 * The checkout envelope, shaped to the recorded Fastify contract:
 * { ok, orderNumber, status, invoiceNumber, accessKey }.
 *
 * invoiceNumber is null and honestly so — invoice numbering is the M2 gst
 * module (a gapless statutory series must not be improvised here), and the
 * contract allows null.
 */
export function completionEnvelope(
  identity: IdentityRow,
  status: string,
): {
  ok: true;
  orderNumber: string;
  status: string;
  invoiceNumber: null;
  accessKey: string;
} {
  return {
    ok: true,
    orderNumber: identity.order_number,
    status,
    invoiceNumber: null,
    accessKey: identity.access_key,
  };
}
