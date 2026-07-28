import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  currentCashPosition,
  ingestRemittanceBatch,
  openRemittanceExceptions,
  remittanceBatches,
  remittanceLedger,
} from "@siumora/db";

import { requireAdmin } from "../lib/auth.ts";

/**
 * COD remittance desk.
 *
 * COD is most of what this shop sells, and the courier holds the cash for the
 * best part of a week before netting off freight and paying the rest. Nobody
 * sends a statement saying what they owe — they send a file, and a seller who
 * does not check it discovers a short collection months later, if ever.
 *
 * Ingest is a POST because it writes, but it is deliberately idempotent: a
 * courier resending yesterday's file is normal, and the second upload returns
 * the same outcomes rather than booking the money twice.
 */

const paise = z.number().int().nonnegative();

const remittanceRowSchema = z.object({
  orderNumber: z.string().trim().min(1),
  collected: paise,
  deductions: paise.default(0),
  remitted: z.number().int(),
  declaredWeightGrams: z.number().int().nonnegative().optional(),
  chargedWeightGrams: z.number().int().nonnegative().optional(),
});

const batchSchema = z.object({
  /** The courier's own batch or UTR reference — the idempotency key. */
  batchId: z.string().trim().min(1),
  courier: z.string().trim().min(1),
  /** When the courier says it paid. Optional: some files omit it. */
  remittedOn: z.iso.datetime().optional(),
  rows: z.array(remittanceRowSchema).min(1).max(2000),
});

export async function registerRemittanceRoutes(server: FastifyInstance) {
  server.post("/admin/remittances", async (request, reply) => {
    const viewer = await requireAdmin(request, reply);
    if (!viewer) return;

    const batch = batchSchema.parse(request.body);

    const result = await ingestRemittanceBatch(server.db, {
      batchId: batch.batchId,
      courier: batch.courier,
      ...(batch.remittedOn ? { remittedOn: new Date(batch.remittedOn) } : {}),
      rows: batch.rows,
    });

    reply.header("Cache-Control", "no-store");
    // 200, not 201: a replay creates nothing, and `recorded` is what says which
    // of the two happened.
    return {
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
      deductionAlarms: result.deductionAlarms.map((row) => ({
        orderNumber: row.orderNumber,
        collected: row.collected,
        deductions: row.deductions,
      })),
    };
  });

  server.get("/admin/remittances", async (request, reply) => {
    const viewer = await requireAdmin(request, reply);
    if (!viewer) return;

    const { batchId } = z
      .object({ batchId: z.string().trim().min(1).optional() })
      .parse(request.query);

    const [batches, exceptions, cash, ledger] = await Promise.all([
      remittanceBatches(server.db),
      openRemittanceExceptions(server.db),
      currentCashPosition(server.db),
      batchId ? remittanceLedger(server.db, { batchId }) : Promise.resolve([]),
    ]);

    reply.header("Cache-Control", "no-store");
    return { batches, exceptions, cash, ...(batchId ? { ledger } : {}) };
  });

  /**
   * Cash position on its own.
   *
   * Separate from the batch report because it is the one number the daily
   * digest wants, and it should not cost a scan of the whole ledger to get.
   */
  server.get("/admin/cash-position", async (request, reply) => {
    const viewer = await requireAdmin(request, reply);
    if (!viewer) return;

    reply.header("Cache-Control", "no-store");
    return currentCashPosition(server.db);
  });
}

type Exception = Awaited<ReturnType<typeof ingestRemittanceBatch>>["rows"][number];

/** The fields an operator working the queue needs, and none of the rest. */
function summarise(entry: Exception) {
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
