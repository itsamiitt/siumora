import { createHmac, timingSafeEqual } from "node:crypto";

// prettier-ignore -- single line so @ts-ignore reaches the specifier
// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import type { NdrReason, OrderStatus } from "@siumora/core";

import type { CreateShipmentInput } from "./client.ts";

/**
 * The courier's decisions, pure (plan 16 Phase F) — what to book for an
 * order, and what a courier's status means for the Siumora status machine.
 */

/** Jewellery ships small. Same defaults as the Fastify booking. */
export const DEFAULT_WEIGHT_KG = 0.3;
export const DEFAULT_DIMENSIONS_CM = { length: 12, breadth: 10, height: 4 } as const;

/** GST state code → the state name Shiprocket wants. The kit's own list, inlined to stay pure. */
const STATE_NAMES: Readonly<Record<string, string>> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka",
  "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};

export interface BookableOrder {
  readonly number: string;
  readonly placedAt: Date;
  readonly paymentMethod: string;
  readonly address: {
    readonly first_name?: string | null;
    readonly last_name?: string | null;
    readonly phone?: string | null;
    readonly address_1?: string | null;
    readonly address_2?: string | null;
    readonly city?: string | null;
    readonly province?: string | null;
    readonly postal_code?: string | null;
  };
  /** The lines being shipped — for a partial fulfillment, only those. */
  readonly lines: ReadonlyArray<{
    readonly title: string;
    readonly sku: string;
    readonly quantity: number;
    readonly unitPricePaise: number;
    readonly hsn?: string;
  }>;
}

/**
 * The Shiprocket booking for an order. Refuses what a courier cannot carry:
 * an unknown state (the label needs its name), no lines, no phone.
 */
export function shipmentFor(
  order: BookableOrder,
  options: { pickupLocation: string },
): CreateShipmentInput | { error: string } {
  const a = order.address;
  const stateName = STATE_NAMES[a.province ?? ""];
  if (!stateName) return { error: `unknown state code ${a.province ?? "(none)"}` };
  if (order.lines.length === 0) return { error: "nothing to ship" };
  if (!a.phone) return { error: "the delivery address has no phone" };

  const subtotalPaise = order.lines.reduce((sum, line) => sum + line.unitPricePaise * line.quantity, 0);
  return {
    orderNumber: order.number,
    orderDate: order.placedAt.toISOString().slice(0, 10),
    pickupLocation: options.pickupLocation,
    address: {
      name: [a.first_name, a.last_name].filter(Boolean).join(" ").trim(),
      phone: a.phone,
      // Line 2 carries the area and the landmark; the courier reads both.
      line1: [a.address_1, a.address_2].filter(Boolean).join(", "),
      city: a.city ?? "",
      stateName,
      pincode: a.postal_code ?? "",
    },
    items: order.lines.map((line) => ({
      name: line.title,
      sku: line.sku,
      units: line.quantity,
      // Rupees: the courier's API takes decimals, the ledger keeps paise.
      sellingPrice: line.unitPricePaise / 100,
      ...(line.hsn ? { hsn: line.hsn } : {}),
    })),
    paymentMethod: order.paymentMethod === "cod" ? "COD" : "Prepaid",
    subTotal: subtotalPaise / 100,
    weightKg: DEFAULT_WEIGHT_KG,
    dimensionsCm: { ...DEFAULT_DIMENSIONS_CM },
  };
}

export function trackingUrl(awb: string): string {
  return `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;
}

// ── Courier webhooks ───────────────────────────────────────────────────────

export type CourierEvent =
  | {
      readonly kind: "status";
      /** The SIU order number when the payload names it, else find by AWB. */
      readonly orderNumber?: string;
      readonly awb?: string;
      readonly status: OrderStatus;
      readonly ndrReason?: NdrReason;
    }
  | { readonly kind: "ignored"; readonly reason: string };

const NDR_REASONS: ReadonlySet<string> = new Set([
  "customer_unavailable",
  "phone_unreachable",
  "address_incomplete",
  "customer_refused",
  "payment_not_ready",
  "premises_closed",
]);
const COURIER_STATUSES: ReadonlySet<string> = new Set([
  "processing",
  "shipped",
  "out_for_delivery",
  "delivered",
  "ndr",
  "rto",
]);

/** A courier's free-text non-delivery reason, read into the NDR vocabulary. */
export function ndrReasonFrom(text: string | undefined): NdrReason {
  const t = (text ?? "").toLowerCase();
  if (/refus|reject|not interested/.test(t)) return "customer_refused";
  if (/address|location|landmark/.test(t)) return "address_incomplete";
  if (/phone|contact|unreachable|switched off|not reachable/.test(t)) return "phone_unreachable";
  if (/closed|premises|office/.test(t)) return "premises_closed";
  if (/cash|payment|money|cod amount/.test(t)) return "payment_not_ready";
  return "customer_unavailable";
}

/**
 * A Shiprocket tracking push → a status move. Shiprocket names states in
 * capitals ("OUT FOR DELIVERY", "RTO INITIATED"); anything that is not a
 * step of the delivery journey (pickup scheduling, manifests) is ignored.
 */
export function parseShiprocketWebhook(body: unknown): CourierEvent {
  const r = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const raw = typeof r.current_status === "string" ? r.current_status : typeof r.shipment_status === "string" ? r.shipment_status : "";
  const state = raw.trim().toUpperCase();
  const awb = typeof r.awb === "string" || typeof r.awb === "number" ? String(r.awb) : undefined;
  const orderNumber = typeof r.order_id === "string" && /^SIU-\d+$/.test(r.order_id) ? r.order_id : undefined;
  if (!awb && !orderNumber) return { kind: "ignored", reason: "no shipment reference" };
  const ref = { ...(orderNumber ? { orderNumber } : {}), ...(awb ? { awb } : {}) };

  if (state.startsWith("RTO")) return { kind: "status", ...ref, status: "rto" };
  if (state === "DELIVERED") return { kind: "status", ...ref, status: "delivered" };
  if (state === "OUT FOR DELIVERY") return { kind: "status", ...ref, status: "out_for_delivery" };
  if (state.startsWith("UNDELIVERED") || state === "NDR") {
    const reason = typeof r.reason === "string" ? r.reason : typeof r.ndr_reason === "string" ? r.ndr_reason : undefined;
    return { kind: "status", ...ref, status: "ndr", ndrReason: ndrReasonFrom(reason) };
  }
  if (
    state === "PICKED UP" ||
    state === "SHIPPED" ||
    state.startsWith("IN TRANSIT") ||
    state.startsWith("REACHED") ||
    state === "MISROUTED"
  ) {
    return { kind: "status", ...ref, status: "shipped" };
  }
  return { kind: "ignored", reason: raw || "no status" };
}

/** The courier-neutral signed format the Fastify webhook spoke: {order_number, status, ndr_reason?}. */
export function parseSignedCourierWebhook(body: unknown): CourierEvent {
  const r = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof r.order_number !== "string" || typeof r.status !== "string" || !COURIER_STATUSES.has(r.status)) {
    return { kind: "ignored", reason: "not a courier status" };
  }
  const ndrReason =
    typeof r.ndr_reason === "string" && NDR_REASONS.has(r.ndr_reason) ? (r.ndr_reason as NdrReason) : undefined;
  return {
    kind: "status",
    orderNumber: r.order_number,
    status: r.status as OrderStatus,
    ...(ndrReason ? { ndrReason } : {}),
  };
}

// ── Authentication ─────────────────────────────────────────────────────────

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Shiprocket sends the token configured in its panel as the x-api-key header. */
export function verifyShiprocketToken(header: string | undefined, token: string | undefined): boolean {
  return Boolean(token && header && safeEqual(header, token));
}

/** The signed format: HMAC-SHA256 of the raw body under the courier secret. */
export function verifyCourierSignature(
  rawBody: string | Buffer | undefined,
  signature: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !signature || rawBody === undefined) return false;
  return safeEqual(createHmac("sha256", secret).update(rawBody).digest("hex"), signature);
}
