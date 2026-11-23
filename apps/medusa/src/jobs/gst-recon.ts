import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { financialYear } from "@siumora/core";

import { recordAudit, type SqlClient as AuditSqlClient } from "../modules/audit/data";
import type { GstInvoiceRow } from "../modules/gst/invoice";
import {
  checkSeries,
  describeFinding,
  reconcileInvoices,
  type ReconFinding,
  type ReconOrderWire,
  type SeriesEntry,
} from "../modules/gst/recon";

/**
 * Daily GST reconciliation (TODO(gst-recon-daily), plan 18 L1.1) — 02:30 IST.
 *
 * The last seven days of orders against their invoices, recomputed from the
 * order lines; on the 1st of the month, the whole financial year. Every live
 * row of the financial years touched is checked for a gapless, unrepeated
 * series. Findings go out as `[money-alert]` lines (instrumentation forwards
 * those to Sentry), one audit row records each run, and nothing is repaired:
 * see the header of modules/gst/recon.ts.
 */

const WEEK_MS = 7 * 24 * 3_600_000;
/** Enough lines to act on; the audit row carries the full count. */
const MAX_ALERT_LINES = 50;

/** What issue.ts reads off an order, plus status to skip drafts. */
const ORDER_FIELDS = [
  "id",
  "status",
  "created_at",
  "shipping_address.province",
  "items.*",
  "items.variant.id",
  "items.variant.metadata",
  "items.variant.product.metadata",
  "items.adjustments.amount",
];

const INVOICE_COLUMNS =
  'id, order_id, financial_year, "sequence", invoice_number, buyer_gstin, interstate, "rows", totals, created_at';

interface RawClient {
  raw(sql: string, bindings: ReadonlyArray<string | number | boolean | null>): Promise<{ rows: unknown[] }>;
}

interface GraphQuery {
  graph(input: { entity: string; fields: string[]; filters: Record<string, unknown> }): Promise<{ data: unknown[] }>;
}

type ReconOrder = ReconOrderWire & { status?: string };

/** The start of the Indian financial year containing `now` (1 April, IST ≈ UTC here). */
function financialYearStart(now: Date): Date {
  const year = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return new Date(Date.UTC(year, 3, 1));
}

export default async function gstRecon(container: MedusaContainer): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as {
    info(message: string): void;
    error(message: string): void;
  };
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as RawClient;
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as unknown as GraphQuery;

  const now = new Date();
  const fullPass = now.getUTCDate() === 1;
  const since = fullPass ? financialYearStart(now) : new Date(now.getTime() - WEEK_MS);

  try {
    const { data: placed } = await query.graph({
      entity: "order",
      fields: ORDER_FIELDS,
      filters: { created_at: { $gte: since } },
    });
    // A draft order is a quote, not a supply: no invoice is owed for it.
    const orders = (placed as ReconOrder[]).filter((order) => order.status !== "draft");

    // An invoice is always written after its order, so every invoice for an
    // order in the window was created inside the window too.
    const invoices = (
      await pg.raw(
        `SELECT ${INVOICE_COLUMNS} FROM gst_invoice WHERE deleted_at IS NULL AND created_at >= ?`,
        [since.toISOString()],
      )
    ).rows as GstInvoiceRow[];

    // Invoices for orders placed just before the window: fetch those orders
    // too, or they would read as orphans.
    const known = new Set(orders.map((order) => order.id));
    const outside = [...new Set(invoices.map((invoice) => invoice.order_id).filter((id) => !known.has(id)))];
    if (outside.length > 0) {
      const { data: older } = await query.graph({ entity: "order", fields: ORDER_FIELDS, filters: { id: outside } });
      orders.push(...(older as ReconOrder[]));
    }

    const years = [...new Set([financialYear(now) as string, ...invoices.map((invoice) => invoice.financial_year)])];
    const series = (
      await pg.raw(
        `SELECT financial_year, "sequence", invoice_number FROM gst_invoice
          WHERE deleted_at IS NULL AND financial_year IN (${years.map(() => "?").join(", ")})`,
        years,
      )
    ).rows as SeriesEntry[];

    const findings: ReconFinding[] = [...reconcileInvoices(orders, invoices), ...checkSeries(series)];
    const numbers = await orderNumbers(pg, findings);

    await recordAudit(pg as AuditSqlClient, {
      actorId: null,
      actorContact: "gst-recon",
      actorRole: "system",
      action: "gst.recon",
      subject: fullPass ? "financial-year" : "week",
      detail: {
        since: since.toISOString(),
        orders: orders.length,
        invoices: invoices.length,
        seriesRows: series.length,
        findings: findings.length,
        kinds: countKinds(findings),
      },
    });

    if (findings.length === 0) {
      logger.info(
        `gst recon: books prove — ${orders.length} orders, ${invoices.length} invoices since ${since.toISOString()}`,
      );
      return;
    }

    logger.error(
      `[money-alert] gst recon: ${findings.length} finding(s) since ${since.toISOString()} — the books need a person before filing`,
    );
    for (const finding of findings.slice(0, MAX_ALERT_LINES)) {
      const number = finding.orderId ? numbers.get(finding.orderId) : undefined;
      logger.error(`[money-alert] gst recon: ${number ? `${number} ` : ""}${describeFinding(finding)}`);
    }
    if (findings.length > MAX_ALERT_LINES) {
      logger.error(`[money-alert] gst recon: ${findings.length - MAX_ALERT_LINES} more finding(s) not shown`);
    }
  } catch (error) {
    // A recon that cannot run is itself a finding: the books went unproven.
    logger.error(
      `[money-alert] gst recon did not run: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function countKinds(findings: ReadonlyArray<ReconFinding>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const finding of findings) counts[finding.kind] = (counts[finding.kind] ?? 0) + 1;
  return counts;
}

/** SIU numbers for the alert lines — what an operator searches by. */
async function orderNumbers(pg: RawClient, findings: ReadonlyArray<ReconFinding>): Promise<Map<string, string>> {
  const ids = [...new Set(findings.map((finding) => finding.orderId).filter((id): id is string => Boolean(id)))].slice(
    0,
    MAX_ALERT_LINES,
  );
  if (ids.length === 0) return new Map();
  const { rows } = await pg.raw(
    `SELECT order_id, order_number FROM siumora_order_identity WHERE order_id IN (${ids.map(() => "?").join(", ")})`,
    ids,
  );
  return new Map((rows as Array<{ order_id: string; order_number: string }>).map((row) => [row.order_id, row.order_number]));
}

export const config = {
  name: "siumora-gst-recon",
  // 21:00 UTC = 02:30 IST, after the day's orders and before anyone files.
  schedule: "0 21 * * *",
};
