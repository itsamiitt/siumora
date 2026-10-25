/**
 * The courier's COD remittance file → the ingest body's rows (plan 16
 * Phase H). Pure and dependency-free: the admin's upload drawer runs it in
 * the browser to preview the batch before posting, and node --test runs it
 * here.
 *
 * Couriers name their columns differently (Shiprocket: "Order ID", "COD
 * Amount", "Remitted Amount"; others "Collected", "Net Amount"), so each
 * field matches any of a few header spellings, case and punctuation
 * ignored. Amounts arrive in rupees ("1,299.00", "₹1299") and leave in
 * integer paise; weights in kilograms leave in grams.
 */

export interface CsvRow {
  orderNumber: string;
  collected: number;
  deductions: number;
  remitted: number;
  declaredWeightGrams?: number;
  chargedWeightGrams?: number;
}

export type CsvParsed = { ok: true; rows: CsvRow[] } | { ok: false; message: string };

const COLUMNS = {
  orderNumber: ["order number", "order no", "order id", "channel order id", "reference", "order"],
  collected: ["collected", "cod amount", "cod collected", "collected amount", "cod"],
  deductions: ["deductions", "deduction", "charges", "freight charges", "total charges"],
  remitted: ["remitted", "remitted amount", "net amount", "net remitted", "amount remitted", "payout"],
  declaredWeight: ["declared weight", "dead weight", "weight declared"],
  chargedWeight: ["charged weight", "applied weight", "billed weight"],
} as const;

function key(header: string): string {
  return header.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** One CSV line, quotes respected ("a, b" stays one cell; "" is a quote). */
function cells(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      out.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  out.push(cell.trim());
  return out;
}

/** "₹1,299.50" → 129950. Negative allowed (a clawback nets below zero). */
export function rupeesToPaise(value: string): number | undefined {
  const cleaned = value.replace(/[₹,\s]|INR|Rs\.?/gi, "");
  if (cleaned === "") return 0;
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  return Math.round(Number(cleaned) * 100);
}

function kgToGrams(value: string): number | undefined {
  const cleaned = value.replace(/kg|\s/gi, "");
  if (cleaned === "") return undefined;
  const number = Number(cleaned);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 1000) : undefined;
}

export function parseRemittanceCsv(text: string): CsvParsed {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) return { ok: false, message: "The file has no rows under its header." };

  const headers = cells(lines[0]!).map(key);
  const find = (names: readonly string[]) => headers.findIndex((header) => names.includes(header));
  const at = {
    orderNumber: find(COLUMNS.orderNumber),
    collected: find(COLUMNS.collected),
    deductions: find(COLUMNS.deductions),
    remitted: find(COLUMNS.remitted),
    declaredWeight: find(COLUMNS.declaredWeight),
    chargedWeight: find(COLUMNS.chargedWeight),
  };
  const missing = (["orderNumber", "collected", "remitted"] as const).filter((field) => at[field] < 0);
  if (missing.length > 0) {
    const names = { orderNumber: "order number", collected: "COD collected", remitted: "remitted amount" };
    return { ok: false, message: `No column for: ${missing.map((field) => names[field]).join(", ")}.` };
  }

  const rows: CsvRow[] = [];
  for (const [index, line] of lines.slice(1).entries()) {
    const row = cells(line);
    const lineNo = index + 2;
    const orderNumber = row[at.orderNumber] ?? "";
    if (!orderNumber) return { ok: false, message: `Line ${lineNo}: no order number.` };
    const collected = rupeesToPaise(row[at.collected] ?? "");
    const remitted = rupeesToPaise(row[at.remitted] ?? "");
    const deductions = at.deductions >= 0 ? rupeesToPaise(row[at.deductions] ?? "") : 0;
    if (collected === undefined || collected < 0) return { ok: false, message: `Line ${lineNo}: collected is not an amount.` };
    if (remitted === undefined) return { ok: false, message: `Line ${lineNo}: remitted is not an amount.` };
    if (deductions === undefined || deductions < 0) return { ok: false, message: `Line ${lineNo}: deductions is not an amount.` };
    const declared = at.declaredWeight >= 0 ? kgToGrams(row[at.declaredWeight] ?? "") : undefined;
    const charged = at.chargedWeight >= 0 ? kgToGrams(row[at.chargedWeight] ?? "") : undefined;
    rows.push({
      orderNumber,
      collected,
      deductions,
      remitted,
      ...(declared !== undefined ? { declaredWeightGrams: declared } : {}),
      ...(charged !== undefined ? { chargedWeightGrams: charged } : {}),
    });
  }
  if (rows.length > 2000) return { ok: false, message: "At most 2000 rows per batch — split the file." };
  return { ok: true, rows };
}
