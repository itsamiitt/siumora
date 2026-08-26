// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import type { RemittanceRow } from "@siumora/core";

/**
 * Pure ingest-body parsing — no Medusa imports, so node --test can
 * strip-type it. Hand-rolled (this app has no zod dependency), mirroring the
 * Fastify batchSchema (apps/api/src/routes/remittance.ts): batchId/courier
 * non-empty, optional ISO remittedOn, 1..2000 rows of integer paise.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export interface ParsedBatch {
  batchId: string;
  courier: string;
  remittedOn?: Date;
  rows: RemittanceRow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPaise(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseRow(raw: unknown, index: number): Parsed<RemittanceRow> {
  const at = `rows[${index}]`;
  if (!isRecord(raw)) return { ok: false, message: `${at}: expected an object` };
  if (typeof raw.orderNumber !== "string" || raw.orderNumber.trim().length === 0) {
    return { ok: false, message: `${at}.orderNumber: expected a non-empty string` };
  }
  if (!isPaise(raw.collected)) {
    return { ok: false, message: `${at}.collected: expected non-negative integer paise` };
  }
  if (raw.deductions !== undefined && !isPaise(raw.deductions)) {
    return { ok: false, message: `${at}.deductions: expected non-negative integer paise` };
  }
  // Remitted may legitimately be negative: a courier clawing back an earlier
  // over-payment nets below zero — the Fastify schema allows any integer.
  if (typeof raw.remitted !== "number" || !Number.isInteger(raw.remitted)) {
    return { ok: false, message: `${at}.remitted: expected integer paise` };
  }
  for (const key of ["declaredWeightGrams", "chargedWeightGrams"] as const) {
    if (raw[key] !== undefined && !isPaise(raw[key])) {
      return { ok: false, message: `${at}.${key}: expected non-negative integer grams` };
    }
  }
  return {
    ok: true,
    value: {
      orderNumber: raw.orderNumber.trim(),
      collected: raw.collected,
      deductions: (raw.deductions as number | undefined) ?? 0,
      remitted: raw.remitted,
      ...(raw.declaredWeightGrams !== undefined
        ? { declaredWeightGrams: raw.declaredWeightGrams as number }
        : {}),
      ...(raw.chargedWeightGrams !== undefined
        ? { chargedWeightGrams: raw.chargedWeightGrams as number }
        : {}),
    },
  };
}

export function parseRemittanceBatch(body: unknown): Parsed<ParsedBatch> {
  if (!isRecord(body)) return { ok: false, message: "body: expected an object" };
  if (typeof body.batchId !== "string" || body.batchId.trim().length === 0) {
    return { ok: false, message: "batchId: expected a non-empty string" };
  }
  if (typeof body.courier !== "string" || body.courier.trim().length === 0) {
    return { ok: false, message: "courier: expected a non-empty string" };
  }
  let remittedOn: Date | undefined;
  if (body.remittedOn !== undefined) {
    if (typeof body.remittedOn !== "string") {
      return { ok: false, message: "remittedOn: expected an ISO datetime string" };
    }
    const parsed = new Date(body.remittedOn);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, message: "remittedOn: expected an ISO datetime string" };
    }
    remittedOn = parsed;
  }
  if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 2000) {
    return { ok: false, message: "rows: expected 1 to 2000 rows" };
  }
  const rows: RemittanceRow[] = [];
  for (const [index, raw] of body.rows.entries()) {
    const parsed = parseRow(raw, index);
    if (!parsed.ok) return parsed;
    rows.push(parsed.value);
  }
  return {
    ok: true,
    value: {
      batchId: body.batchId.trim(),
      courier: body.courier.trim(),
      ...(remittedOn ? { remittedOn } : {}),
      rows,
    },
  };
}
