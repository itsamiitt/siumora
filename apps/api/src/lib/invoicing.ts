import type { FastifyInstance } from "fastify";

import { financialYear, invoiceNumber } from "@siumora/core";
import { eq, schema, sql, type Database } from "@siumora/db";

import { queueOrderConversion } from "./conversions.ts";
import { queueOrderMessage } from "./messaging.ts";

/**
 * Move an order to a status, allocating its invoice number if it is the one
 * that raises the invoice.
 *
 * Three paths reach `confirmed` — the payment webhook, the COD confirmation,
 * and the courier stand-in — and each used to allocate its own number, or
 * forget to. An order that reaches `delivered` with no invoice number is a
 * compliance problem for a GST-registered seller, not a cosmetic gap, so the
 * allocation lives here and every path goes through it.
 *
 * The number is only ever issued once per order, and the series is serialised
 * on a table lock: two confirmations landing together must not take the same
 * number out of a series that has to be unique within its financial year.
 *
 * The conversion and the customer's message are queued here too, for the same
 * reason: this is the one place a status changes, so no path can move an order
 * without the analytics side and the customer being considered. Queueing from
 * each caller instead is how the payment webhook ends up silently not reporting
 * revenue, and the courier webhook silently stops sending dispatch notices.
 */
export async function setOrderStatus(
  server: FastifyInstance,
  order: {
    id: string;
    status: string;
    placedAt: Date;
    invoiceNumber: string | null;
    lines: ReadonlyArray<typeof schema.orderLines.$inferSelect>;
  },
  status: string,
  extra: Partial<typeof schema.orders.$inferInsert> = {},
) {
  const db: Database = server.db;
  // Only `confirmed` raises an invoice, and only for an order without one. A
  // held order that is never confirmed must not burn a number from the series.
  const needsInvoice = status === "confirmed" && !order.invoiceNumber;

  if (!needsInvoice) {
    const [plain] = await db
      .update(schema.orders)
      .set({ status, ...extra })
      .where(eq(schema.orders.id, order.id))
      .returning();
    await queueOrderConversion(server, plain!, order.lines);
    await queueOrderMessage(server, plain!);
    return plain!;
  }

  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE orders IN SHARE ROW EXCLUSIVE MODE`);
    const fy = financialYear(order.placedAt);

    const next = await tx.execute(
      sql`SELECT COALESCE(MAX(invoice_sequence), 0) + 1 AS next FROM orders WHERE financial_year = ${fy}`,
    );
    const sequence = Number((next.rows[0] as { next: number }).next);

    const [row] = await tx
      .update(schema.orders)
      .set({
        status,
        invoiceNumber: invoiceNumber(sequence, order.placedAt),
        invoiceSequence: sequence,
        financialYear: fy,
        ...extra,
      })
      .where(eq(schema.orders.id, order.id))
      .returning();

    return row!;
  });

  // Outside the transaction on purpose: neither a ledger write nor a queued
  // message may roll back an invoice number already taken out of the series.
  await queueOrderConversion(server, updated, order.lines);
  await queueOrderMessage(server, updated);
  return updated;
}
