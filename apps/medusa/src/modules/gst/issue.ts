// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { financialYear, isInterState, isValidGstin } from "@siumora/core";

import { allocateInvoice, type GstTxClient } from "./allocate";
import { computeInvoice, toInvoiceLines, type GstInvoiceRow, type InvoiceLineWire } from "./invoice";

/**
 * Invoice issue at completion (design doc M2; Fastify parity: COD confirms
 * at placement — packages/db placeOrder issues the invoice inside the
 * placement transaction whenever the initial status is "confirmed", and the
 * api.test.ts contract "places an order and issues an invoice" records it.
 * Here placement IS completion, so the complete route calls this right
 * after identity allocation).
 *
 * Idempotent end to end: an order that already holds an invoice gets that
 * invoice back (allocate.ts ON CONFLICT per order), so replays and races
 * can never double-issue.
 *
 * TODO(gst-recon-daily): the daily reconciliation job that proves these
 * rows against Medusa's own order totals (the second half of the migration
 * header's disposition) is M2's separate recon work-item and plugs in over
 * this module's table. Not built here.
 */

/** Structural slice of Medusa's query.graph so this file stays strippable. */
export interface GraphQuery {
  graph(input: {
    entity: string;
    fields: string[];
    filters: Record<string, unknown>;
  }): Promise<{ data: unknown[] }>;
}

interface InvoiceOrderWire {
  id: string;
  created_at: string | Date;
  metadata?: Record<string, unknown> | null;
  shipping_address?: { province?: string | null } | null;
  items?: Array<InvoiceLineWire | null> | null;
}

/**
 * Ensure the statutory invoice for a completed order exists, and return it.
 *
 * Throws — refusing the issue, never writing — when the order cannot carry
 * a lawful invoice: no lines, a line without HSN/slab, no delivery state
 * (place of supply is a required field), or totals that fail the
 * reconciliation assertion. The caller decides what the refusal means for
 * its envelope (the complete route logs and serves invoiceNumber null,
 * exactly the shape the contract already allows).
 */
export async function ensureInvoiceForOrder(
  pg: GstTxClient,
  query: GraphQuery,
  orderId: string,
): Promise<GstInvoiceRow> {
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "created_at",
      "metadata",
      "shipping_address.province",
      // items.* rather than a field list: quantity is a computed field that
      // resolves undefined when named explicitly (probed on 2.18.0).
      "items.*",
      "items.variant.id",
      "items.variant.metadata",
      "items.variant.product.metadata",
    ],
    filters: { id: orderId },
  });
  const order = orders[0] as InvoiceOrderWire | undefined;
  if (!order) {
    throw new Error(`invoice refused: order ${orderId} not found`);
  }

  const province = order.shipping_address?.province;
  if (typeof province !== "string" || province.trim().length === 0) {
    // Place of supply decides IGST vs CGST+SGST and is a rule 46 field; an
    // invoice guessed without it would misfile the return.
    throw new Error(
      `invoice refused: order ${orderId} has no delivery state (place of supply)`,
    );
  }

  const lines = toInvoiceLines(
    (order.items ?? []).filter((item): item is InvoiceLineWire => Boolean(item)),
  );
  const interState = isInterState(province);
  const { rows, totals } = computeInvoice(lines, { interState });

  // Dated when the order was placed — the date the number is allocated
  // against (the supply), not when somebody completed a replay.
  const fy = financialYear(new Date(order.created_at));

  // A registered buyer's GSTIN rides order metadata when checkout captured
  // one; a value that does not verify by check digit is left off the
  // statutory row rather than printed wrong (Fastify refuses it at entry).
  const metadataGstin = order.metadata?.buyer_gstin;
  const buyerGstin =
    typeof metadataGstin === "string" && isValidGstin(metadataGstin)
      ? metadataGstin
      : null;

  const allocation = await allocateInvoice(pg, {
    orderId: order.id,
    financialYear: fy,
    buyerGstin,
    interstate: interState,
    rows,
    totals,
  });
  return allocation.invoice;
}
