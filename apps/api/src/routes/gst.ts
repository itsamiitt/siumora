import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { buildGstr1, type CartLine, type Gstr1Order } from "@siumora/core";
import { desc, inArray, schema } from "@siumora/db";

import { requireAdmin } from "../lib/auth.ts";

/**
 * The GST desk.
 *
 * Produces the data a GSTR-1 return is filed from, computed by the same engine
 * that produced the invoices. A spreadsheet re-derived from exports drifts from
 * the invoices it is meant to summarise, and the mismatch surfaces months later
 * as a notice.
 *
 * It stops at the data. Filing is the seller's accountant's job and this does
 * not pretend to be a portal integration.
 */

const periodQuery = z.object({
  /** YYYY-MM. The tax period is an Indian calendar month. */
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  format: z.enum(["json", "csv"]).optional(),
});

/** Statuses that represent a supply actually made. */
const SUPPLIED = [
  "confirmed",
  "processing",
  "shipped",
  "out_for_delivery",
  "delivered",
  "ndr",
] as const;

export async function registerGstRoutes(server: FastifyInstance) {
  server.get("/admin/gstr1", async (request, reply) => {
    const viewer = await requireAdmin(request, reply);
    if (!viewer) return;

    const { period, format } = periodQuery.parse(request.query);

    const rows = await server.db
      .select()
      .from(schema.orders)
      .where(inArray(schema.orders.status, [...SUPPLIED]))
      .orderBy(desc(schema.orders.placedAt));

    const invoiced = rows.filter((row) => row.invoiceNumber !== null);
    const lines = invoiced.length
      ? await server.db
          .select()
          .from(schema.orderLines)
          .where(
            inArray(
              schema.orderLines.orderId,
              invoiced.map((row) => row.id),
            ),
          )
      : [];

    const byOrder = new Map<string, CartLine[]>();
    for (const line of lines) {
      const bucket = byOrder.get(line.orderId) ?? [];
      bucket.push({
        variantId: line.variantId,
        sku: line.sku,
        productHandle: line.productHandle,
        title: line.title,
        variantTitle: line.variantTitle,
        imageUrl: line.imageUrl,
        mrp: line.mrp,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        gstSlab: line.gstSlab as CartLine["gstSlab"],
        hsn: line.hsn,
        piercedJewellery: line.piercedJewellery,
      });
      byOrder.set(line.orderId, bucket);
    }

    const orders: Gstr1Order[] = invoiced.map((row) => ({
      invoiceNumber: row.invoiceNumber,
      // The invoice is dated when the order was placed, which is the date the
      // number was allocated against — not when the courier moved it.
      invoiceDate: row.placedAt,
      total: row.total,
      stateCode: (row.address as { stateCode: string }).stateCode,
      buyerGstin: row.buyerGstin,
      lines: byOrder.get(row.id) ?? [],
    }));

    const gstr1 = buildGstr1(orders, period);

    reply.header("Cache-Control", "no-store");

    if (format === "csv") {
      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header(
        "Content-Disposition",
        `attachment; filename="gstr1-${period}.csv"`,
      );
      return toCsv(gstr1);
    }

    return gstr1;
  });
}

/** Paise to the rupee string the portal's templates expect. */
function rupees(paise: number): string {
  return (paise / 100).toFixed(2);
}

/**
 * One CSV carrying all four tables, each with its own header row.
 *
 * The portal takes a separate file per table; combining them here means the
 * accountant sees the whole return in one place and splits it, rather than
 * downloading four files and hoping they came from the same run.
 */
function toCsv(gstr1: ReturnType<typeof buildGstr1>): string {
  const out: string[] = [];

  out.push(`GSTR-1,${gstr1.period}`);
  out.push("");

  out.push("B2B");
  out.push("GSTIN,Invoice,Date,Value,Place of supply,Reverse charge,Rate,Taxable value,Tax");
  for (const invoice of gstr1.b2b) {
    for (const row of invoice.rows) {
      out.push(
        [
          invoice.gstin,
          invoice.invoiceNumber,
          invoice.invoiceDate,
          rupees(invoice.invoiceValue),
          invoice.placeOfSupply,
          invoice.reverseCharge ? "Y" : "N",
          row.slab,
          rupees(row.taxableValue),
          rupees(row.cgst + row.sgst + row.igst),
        ].join(","),
      );
    }
  }

  out.push("");
  out.push("B2CL");
  out.push("Invoice,Date,Value,Place of supply,Rate,Taxable value,Tax");
  for (const invoice of gstr1.b2cl) {
    for (const row of invoice.rows) {
      out.push(
        [
          invoice.invoiceNumber,
          invoice.invoiceDate,
          rupees(invoice.invoiceValue),
          invoice.placeOfSupply,
          row.slab,
          rupees(row.taxableValue),
          rupees(row.igst),
        ].join(","),
      );
    }
  }

  out.push("");
  out.push("B2CS");
  out.push("Type,Place of supply,Rate,Taxable value,CGST,SGST,IGST");
  for (const row of gstr1.b2cs) {
    out.push(
      [
        row.type === "inter" ? "OE" : "OE",
        row.placeOfSupply,
        row.slab,
        rupees(row.taxableValue),
        rupees(row.cgst),
        rupees(row.sgst),
        rupees(row.igst),
      ].join(","),
    );
  }

  out.push("");
  out.push("HSN");
  out.push("HSN,Rate,Taxable value,CGST,SGST,IGST,Total");
  for (const row of gstr1.hsn) {
    out.push(
      [
        row.hsn,
        row.slab,
        rupees(row.taxableValue),
        rupees(row.cgst),
        rupees(row.sgst),
        rupees(row.igst),
        rupees(row.total),
      ].join(","),
    );
  }

  return out.join("\n");
}
