// @ts-ignore -- TS1479 until @siumora/core ships require-condition types
import type { buildGstr1 } from "@siumora/core";

/**
 * GSTR-1 CSV rendering, ported verbatim from apps/api/src/routes/gst.ts —
 * pure, no Medusa imports, so node --test can strip-type it.
 *
 * One CSV carrying all four tables, each with its own header row. The
 * portal takes a separate file per table; combining them here means the
 * accountant sees the whole return in one place and splits it, rather than
 * downloading four files and hoping they came from the same run.
 */

/** Paise to the rupee string the portal's templates expect. */
function rupees(paise: number): string {
  return (paise / 100).toFixed(2);
}

export function gstr1Csv(gstr1: ReturnType<typeof buildGstr1>): string {
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
        "OE",
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
