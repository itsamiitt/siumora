import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import { cashPosition, type ExpectedOrder } from "@siumora/core";

import { loadDomainOrders } from "../../../../lib/domain-orders";
import { auditAction, requireOperator } from "../../../../lib/operator-gate";
import { parseRemittanceBatch } from "../../../../modules/remittance/batch";
import {
  ingestRemittanceBatch,
  openRemittanceExceptions,
  reconciledOrderNumbers,
  remittanceBatches,
  remittanceLedger,
  settledElsewhere,
  type SqlClient,
} from "../../../../modules/remittance/data";

/**
 * The COD remittance desk, ported from apps/api/src/routes/remittance.ts.
 *
 * POST ingests a courier's file — deliberately idempotent: a resent file is
 * normal, and the second upload returns the same outcomes rather than
 * booking the money twice (unique (batch_id, order_number), recorded: 0 on
 * the replay). GET is the report: batches, open exceptions, the cash
 * position, and one batch's ledger when asked.
 */
export const AUTHENTICATE = false;

function pg(req: MedusaRequest): SqlClient {
  return req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as SqlClient;
}

type Summarisable = {
  row: { orderNumber: string; collected: number };
  outcome: string;
  expected: number;
  variance: number;
  excessWeightGrams: number;
  note?: string;
};

/** The fields an operator working the queue needs, and none of the rest. */
function summarise(entry: Summarisable) {
  return {
    orderNumber: entry.row.orderNumber,
    outcome: entry.outcome,
    collected: entry.row.collected,
    expected: entry.expected,
    variance: entry.variance,
    excessWeightGrams: entry.excessWeightGrams,
    ...(entry.note ? { note: entry.note } : {}),
  };
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const operator = await requireOperator(req, res, "remittance:write");
  if (!operator) return;

  const parsed = parseRemittanceBatch(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "invalid_request", message: parsed.message });
    return;
  }
  const batch = parsed.value;

  // What the shop believes about the named orders — the same assembled
  // truth every desk reads (identity + status row + computed paise totals).
  const numbers = [...new Set(batch.rows.map((row) => row.orderNumber))];
  const records = await loadDomainOrders(req, { limit: 5000 });
  const byNumber = new Map(records.map((record) => [record.order.number, record]));
  const settled = await settledElsewhere(pg(req), numbers, batch.batchId);

  const expected: ExpectedOrder[] = numbers.flatMap((number) => {
    const record = byNumber.get(number);
    if (!record) return [];
    return [
      {
        orderNumber: number,
        total: record.order.totals.total,
        paymentMethod: record.order.paymentMethod,
        status: record.order.status,
        alreadyReconciled: settled.has(number),
      },
    ];
  });
  const orderIdByNumber = new Map(
    records.map((record) => [record.order.number, record.orderId]),
  );

  const result = await ingestRemittanceBatch(pg(req), batch, expected, orderIdByNumber);

  await auditAction(req, operator, "remittance.ingest", {
    subject: result.batchId,
    detail: {
      courier: batch.courier,
      rows: batch.rows.length,
      recorded: result.recorded,
      shortfall: result.shortfall,
    },
  });

  res.setHeader("Cache-Control", "no-store");
  // 200, not 201: a replay creates nothing, and `recorded` is what says
  // which of the two happened.
  res.json({
    batchId: result.batchId,
    recorded: result.recorded,
    replayed: result.recorded === 0,
    collected: result.collected,
    expected: result.expected,
    remitted: result.remitted,
    deductions: result.deductions,
    shortfall: result.shortfall,
    counts: result.counts,
    exceptions: result.exceptions.map(summarise),
    weightDisputes: result.weightDisputes.map(summarise),
    deductionAlarms: result.deductionAlarms.map((row: { orderNumber: string; collected: number; deductions: number }) => ({
      orderNumber: row.orderNumber,
      collected: row.collected,
      deductions: row.deductions,
    })),
  });
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  // Any operator may read the desk (the Fastify GET gates on requireAdmin,
  // not a permission) — metrics:read is the floor every role holds.
  const operator = await requireOperator(req, res, "metrics:read");
  if (!operator) return;

  const rawBatchId = req.query.batchId;
  const batchId =
    typeof rawBatchId === "string" && rawBatchId.trim().length > 0
      ? rawBatchId.trim()
      : undefined;

  const client = pg(req);
  const [batches, exceptions, records, reconciled, ledger] = await Promise.all([
    remittanceBatches(client),
    openRemittanceExceptions(client),
    loadDomainOrders(req, { limit: 5000 }),
    reconciledOrderNumbers(client),
    batchId ? remittanceLedger(client, batchId) : Promise.resolve([]),
  ]);

  const cash = cashPosition(
    records.map((record) => ({
      total: record.order.totals.total,
      paymentMethod: record.order.paymentMethod,
      status: record.order.status,
      reconciled: reconciled.has(record.order.number),
    })),
  );

  res.setHeader("Cache-Control", "no-store");
  res.json({ batches, exceptions, cash, ...(batchId ? { ledger } : {}) });
}
