import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { ORIGIN_STATE_CODE, buildInvoice, renderInvoicePdf, sellerConfigured, type Seller, type ShippingAddress } from "@siumora/core";

import {
  findInvoiceByOrderId,
  type GstSqlClient,
} from "../../../../../../modules/gst/allocate";
import { toInvoiceLines, type InvoiceLineWire } from "../../../../../../modules/gst/invoice";
import {
  findIdentityByNumber,
  type SqlClient,
} from "../../../../../../modules/siumora-order/allocate";
import {
  isWellFormedAccessKey,
  majorToPaise,
  wireNumber,
} from "../../../../../../modules/siumora-order/identity";

/**
 * GET /store/siumora/orders/:number/invoice.pdf?key=<uuid> — the tax
 * invoice, as a PDF (the Fastify /orders/:number/invoice.pdf, ported).
 *
 * Authorised exactly as reading the order is — the mirrored contract:
 * - a MALFORMED key (not a uuid) is a 400 invalid_request;
 * - no key, a wrong-but-well-formed key, or an unknown number are all the
 *   same 404 — an invoice carries the buyer's name, address and phone, so
 *   an endpoint that only checked the order number would be a directory of
 *   everyone who has ever bought here;
 * - the correct key (or the signed-in owner) gets application/pdf bytes.
 *
 * Two refusals past auth, both Fastify's, same codes and error keys:
 * - 409 no_invoice for an order that never raised one (SIU-00001 predates
 *   the gst module) — producing a document there would be issuing an
 *   invoice outside the series;
 * - 503 seller_not_configured when the SELLER_* env is incomplete — a tax
 *   invoice with a dash where the GSTIN belongs looks official enough that
 *   nobody would check it.
 *
 * Layout and arithmetic are core's buildInvoice + renderInvoicePdf — the
 * same engine that renders the Fastify PDF, over the same paise.
 */

/**
 * The seller, from the environment — the exact names apps/api/src/server.ts
 * reads (SELLER_NAME etc.), with core's placeholder dashes where a value is
 * missing so sellerConfigured() can refuse exactly as the Fastify app does.
 */
function sellerFromEnv(env: NodeJS.ProcessEnv): Seller {
  return {
    name: env.SELLER_NAME ?? "—",
    address: env.SELLER_ADDRESS ?? "—",
    gstin: env.SELLER_GSTIN ?? "—",
    stateCode: env.SELLER_STATE_CODE ?? ORIGIN_STATE_CODE,
    email: env.SELLER_EMAIL ?? "—",
    phone: env.SELLER_PHONE ?? "—",
  };
}

/** Medusa's shipping address → the domain ShippingAddress the invoice bills to. */
function toBillTo(address: Record<string, unknown>): ShippingAddress {
  const s = (value: unknown) => (typeof value === "string" ? value : "");
  const name = [s(address.first_name), s(address.last_name)]
    .filter(Boolean)
    .join(" ")
    .trim();
  const line2 = s(address.address_2);
  return {
    name: name || "Customer",
    phone: s(address.phone),
    line1: s(address.address_1),
    ...(line2 ? { line2 } : {}),
    city: s(address.city),
    stateCode: s(address.province),
    pincode: s(address.postal_code),
  };
}

interface PdfOrderWire {
  id: string;
  created_at: string | Date;
  customer_id: string | null;
  /** BigNumber on the wire — unwrap through wireNumber, never arithmetic. */
  shipping_total: unknown;
  shipping_address?: Record<string, unknown> | null;
  items?: Array<InvoiceLineWire | null> | null;
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const number = req.params.number!;
  const rawKey = req.query.key;
  const key = typeof rawKey === "string" ? rawKey : undefined;

  // Malformed key: the 400 arm. Shaped like the Fastify zod-failure 400s.
  if (
    (rawKey !== undefined && typeof rawKey !== "string") ||
    (key !== undefined && !isWellFormedAccessKey(key))
  ) {
    res.status(400).json({
      error: "invalid_request",
      message: "key: expected a UUID access key",
    });
    return;
  }

  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const identity = await findIdentityByNumber(
    pgConnection as unknown as SqlClient,
    number,
  );
  if (!identity) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "created_at",
      "customer_id",
      "shipping_total",
      "shipping_address.*",
      // items.* rather than a field list: quantity is a computed field that
      // resolves undefined when named explicitly (probed on 2.18.0).
      "items.*",
      "items.variant.id",
      "items.variant.metadata",
      "items.variant.product.metadata",
    ],
    filters: { id: identity.order_id },
  });
  const order = orders[0] as PdfOrderWire | undefined;
  if (!order) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  // Owning the order (session) or holding the key issued at checkout — the
  // same two grants the Fastify route honours. Everything else: 404.
  const actorId = (req as { auth_context?: { actor_id?: string } }).auth_context
    ?.actor_id;
  const isOwner = Boolean(actorId && order.customer_id && actorId === order.customer_id);
  const holdsKey = key !== undefined && key === identity.access_key;
  if (!isOwner && !holdsKey) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const invoiceRow = await findInvoiceByOrderId(
    pgConnection as unknown as GstSqlClient,
    identity.order_id,
  );
  if (!invoiceRow) {
    // No number allocated means no supply was ever invoiced. Producing a
    // document for it would be issuing an invoice outside the series.
    res.status(409).json({
      error: "no_invoice",
      message: "No invoice has been raised for this order yet.",
    });
    return;
  }

  const seller = sellerFromEnv(process.env);
  if (!sellerConfigured(seller)) {
    // Refused rather than printed with a dash where the registration number
    // belongs — a document that looks official enough that nobody checks.
    res.status(503).json({
      error: "seller_not_configured",
      message:
        "The seller's registered details are not configured, so a tax invoice cannot be issued.",
    });
    return;
  }

  const lines = toInvoiceLines(
    (order.items ?? []).filter((item): item is InvoiceLineWire => Boolean(item)),
  );
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const shipping = majorToPaise(wireNumber(order.shipping_total, "shipping_total"));
  const codFee = 0;

  const invoice = buildInvoice({
    invoiceNumber: invoiceRow.invoice_number,
    // Dated when the number was allocated against the order, which is when
    // the supply was made — not when somebody asked for the file.
    invoiceDate: new Date(order.created_at),
    orderNumber: identity.order_number,
    seller,
    billTo: toBillTo(order.shipping_address ?? {}),
    buyerGstin: invoiceRow.buyer_gstin,
    lines,
    shipping,
    codFee,
    total: subtotal + shipping + codFee,
    paymentMethod: "cod",
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="invoice-${identity.order_number}.pdf"`,
  );
  res.send(renderInvoicePdf(invoice));
}
