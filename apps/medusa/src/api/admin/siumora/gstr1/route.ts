import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { buildGstr1, type Gstr1Order, type OrderStatus } from "@siumora/core";

import { loadDomainOrders } from "../../../../lib/domain-orders";
import { gstr1Csv } from "../../../../lib/gstr1-csv";
import { auditAction, requireOperator } from "../../../../lib/operator-gate";

/**
 * GET /admin/siumora/gstr1?period=YYYY-MM[&format=csv] — the GST desk,
 * ported from apps/api/src/routes/gst.ts. Produces the data a GSTR-1 return
 * is filed from, computed by the same engine that produced the invoices
 * (core buildGstr1 over the stored gst_invoice rows joined to their
 * orders), so the return and the invoices cannot drift apart.
 *
 * Owner only (gst:read): a GSTR-1 export is every customer's state in one
 * file — and it is audited as a read (gst.export), unusually, because a
 * bulk export of customer data is worth knowing about even though it
 * changed nothing.
 */
export const AUTHENTICATE = false;

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Statuses that represent a supply actually made (Fastify SUPPLIED list). */
const SUPPLIED: ReadonlySet<OrderStatus> = new Set([
  "confirmed",
  "processing",
  "shipped",
  "out_for_delivery",
  "delivered",
  "ndr",
] as OrderStatus[]);

interface InvoiceListRow {
  order_id: string;
  invoice_number: string;
  buyer_gstin: string | null;
  created_at: string | Date;
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "gst:read");
  if (!operator) return;

  const period = typeof req.query.period === "string" ? req.query.period : "";
  const format = req.query.format === "csv" ? "csv" : "json";
  if (!PERIOD.test(period)) {
    res.status(400).json({
      error: "invalid_request",
      message: "period: expected YYYY-MM",
    });
    return;
  }

  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as {
    raw(sql: string, bindings: ReadonlyArray<string>): Promise<{ rows: unknown[] }>;
  };
  // The invoice is dated when it was issued (order completion — the date
  // the number was allocated against), which is created_at on the row.
  const invoiceResult = await pg.raw(
    `SELECT order_id, invoice_number, buyer_gstin, created_at
       FROM gst_invoice WHERE deleted_at IS NULL`,
    [],
  );
  const invoices = invoiceResult.rows as InvoiceListRow[];

  const records = invoices.length
    ? await loadDomainOrders(req, {
        orderIds: invoices.map((row) => row.order_id),
      })
    : [];
  const recordByOrderId = new Map(records.map((record) => [record.orderId, record]));

  const orders: Gstr1Order[] = invoices.flatMap((invoice) => {
    const record = recordByOrderId.get(invoice.order_id);
    if (!record) return [];
    return [
      {
        invoiceNumber: invoice.invoice_number,
        invoiceDate: new Date(invoice.created_at),
        total: record.order.totals.total,
        stateCode: record.order.address.stateCode,
        buyerGstin: invoice.buyer_gstin,
        lines: record.order.lines,
        // A supply never made (cancelled, RTO'd, returned) is excluded the
        // way the Fastify route's SUPPLIED filter excludes it.
        excluded: !SUPPLIED.has(record.order.status),
      },
    ];
  });

  const gstr1 = buildGstr1(orders, period);

  await auditAction(req, operator, "gst.export", {
    subject: period,
    detail: { format, invoices: gstr1.totals.invoices },
  });

  res.setHeader("Cache-Control", "no-store");

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="gstr1-${period}.csv"`,
    );
    res.send(gstr1Csv(gstr1));
    return;
  }

  res.json(gstr1);
}
