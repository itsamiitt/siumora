/**
 * The courier's pincode list, as a CSV an owner pastes or uploads (plan 16
 * B25) — pure, so node --test pins it.
 *
 * Columns, by header name in any order: pincode, city, state_code,
 * serviceable, cod_available, estimated_days, rto_rate_bps. Only pincode
 * and state_code are required; the rest default to the table's defaults.
 * Every row is checked before anything is written, and the import reports
 * row by row what is wrong — a courier file with one bad line should be
 * fixable from the message, not a mystery.
 */

export interface ImportRow {
  pincode: string;
  city: string;
  state_code: string;
  serviceable: boolean;
  cod_available: boolean;
  estimated_days: string;
  rto_rate_bps: number;
}

export const MAX_IMPORT_ROWS = 50_000;

const PINCODE_RE = /^[1-9]\d{5}$/;
const STATE_CODE_RE = /^\d{2}$/;

function bool(raw: string | undefined, fallback: boolean): boolean | undefined {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(value)) return true;
  if (["false", "no", "n", "0"].includes(value)) return false;
  return undefined;
}

/** One CSV line → cells. Handles quoted cells with commas and doubled quotes. */
function cells(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((cell) => cell.trim());
}

export function parsePincodeCsv(
  csv: string,
): { ok: true; rows: ImportRow[] } | { ok: false; errors: string[] } {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) return { ok: false, errors: ["The file needs a header row and at least one pincode."] };
  if (lines.length - 1 > MAX_IMPORT_ROWS) {
    return { ok: false, errors: [`At most ${MAX_IMPORT_ROWS} pincodes per import.`] };
  }

  const header = cells(lines[0]!).map((name) => name.toLowerCase());
  const at = (name: string) => header.indexOf(name);
  if (at("pincode") < 0 || at("state_code") < 0) {
    return { ok: false, errors: ["The header must name at least pincode and state_code."] };
  }

  const errors: string[] = [];
  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  lines.slice(1).forEach((line, index) => {
    const lineNo = index + 2;
    const c = cells(line);
    const get = (name: string) => (at(name) >= 0 ? c[at(name)] : undefined);
    const pincode = get("pincode") ?? "";
    const stateCode = (get("state_code") ?? "").padStart(2, "0");
    const serviceable = bool(get("serviceable"), true);
    const cod = bool(get("cod_available"), false);
    const rtoRaw = get("rto_rate_bps");
    const rto = rtoRaw === undefined || rtoRaw === "" ? 0 : Number(rtoRaw);

    if (!PINCODE_RE.test(pincode)) errors.push(`Line ${lineNo}: "${pincode}" is not a six-digit pincode.`);
    else if (seen.has(pincode)) errors.push(`Line ${lineNo}: ${pincode} appears twice.`);
    if (!STATE_CODE_RE.test(stateCode)) errors.push(`Line ${lineNo}: state_code must be the two-digit GST code.`);
    if (serviceable === undefined) errors.push(`Line ${lineNo}: serviceable must be yes or no.`);
    if (cod === undefined) errors.push(`Line ${lineNo}: cod_available must be yes or no.`);
    if (!Number.isInteger(rto) || rto < 0 || rto > 10_000) {
      errors.push(`Line ${lineNo}: rto_rate_bps must be a whole number from 0 to 10000.`);
    }
    seen.add(pincode);
    rows.push({
      pincode,
      city: get("city") ?? "",
      state_code: stateCode,
      serviceable: serviceable ?? true,
      cod_available: cod ?? false,
      estimated_days: get("estimated_days") || "4–6",
      rto_rate_bps: Number.isInteger(rto) ? rto : 0,
    });
  });

  // Enough to fix the file, not a wall of the same mistake.
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 20) };
  return { ok: true, rows };
}
