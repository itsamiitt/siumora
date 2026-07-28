import { printRupees, type InvoiceDocument } from "./invoice-document.ts";
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PdfPage,
  measure,
  renderPdf,
  truncate,
} from "./pdf.ts";

/**
 * The tax invoice, laid out.
 *
 * Layout only — every figure on the page comes from `buildInvoice`, so the
 * arithmetic is tested without rendering anything and this file cannot quietly
 * disagree with the return that was filed.
 *
 * One A4 page. An order of eight pieces is a long one for this shop, and a
 * layout that spilled to a second page would need running totals, a carried-
 * forward line and a page counter for a case that has not happened yet. When it
 * does, the line table is where to start.
 */

const MARGIN = 40;
const RIGHT = PAGE_WIDTH - MARGIN;
const LINE_HEIGHT = 13;

/**
 * Column geometry for the line table.
 *
 * The money columns are right edges, not left ones, because the figures are
 * right-aligned and what has to be controlled is where they end. The gaps
 * between them are wide enough for the longest amount this shop will print: a
 * first draft had 80 points where a lakh-rupee figure needs 40, and two columns
 * ran together into "1,904.762,000.00" on the first rendered page.
 */
const COL = {
  description: MARGIN + 4,
  /** Longest a title may be before it is truncated. */
  descriptionWidth: 195,
  hsn: MARGIN + 210,
  qtyRight: MARGIN + 270,
  rateRight: MARGIN + 350,
  taxableRight: MARGIN + 430,
  amountRight: RIGHT - 4,
};

export function renderInvoicePdf(invoice: InvoiceDocument): Buffer {
  const page = new PdfPage();
  // Worked in "distance from the top", because that is how anybody reading the
  // layout thinks; converted once, here.
  let top = MARGIN;
  const y = (fromTop: number) => PAGE_HEIGHT - fromTop;

  page.text("TAX INVOICE", MARGIN, y(top + 10), { font: "Helvetica-Bold", size: 14 });
  page.textRight(invoice.invoiceNumber, RIGHT, y(top + 4), {
    font: "Helvetica-Bold",
    size: 10,
  });
  page.textRight(`Dated ${invoice.invoiceDate}`, RIGHT, y(top + 16), { size: 8 });
  top += 24;

  page.line(MARGIN, y(top), RIGHT, y(top), 1);
  top += 16;

  // ── Seller ──────────────────────────────────────────────────
  page.text(invoice.seller.name, MARGIN, y(top), { font: "Helvetica-Bold", size: 10 });
  top += LINE_HEIGHT;
  for (const row of wrap(invoice.seller.address, 240, 8)) {
    page.text(row, MARGIN, y(top), { size: 8 });
    top += 10;
  }
  page.text(`GSTIN ${invoice.seller.gstin}`, MARGIN, y(top), { size: 8 });
  top += 10;
  page.text(
    `${invoice.seller.email}  ${invoice.seller.phone}`,
    MARGIN,
    y(top),
    { size: 8 },
  );

  // ── Buyer, in a column beside the seller ────────────────────
  let buyerTop = MARGIN + 40;
  const buyerX = MARGIN + 300;
  page.text("Billed to", buyerX, y(buyerTop), { font: "Helvetica-Bold", size: 8 });
  buyerTop += 12;
  page.text(invoice.billTo.name, buyerX, y(buyerTop), { size: 9 });
  buyerTop += 11;

  for (const row of wrap(addressLine(invoice), 220, 8)) {
    page.text(row, buyerX, y(buyerTop), { size: 8 });
    buyerTop += 10;
  }
  page.text(`Phone ${invoice.billTo.phone}`, buyerX, y(buyerTop), { size: 8 });
  buyerTop += 10;

  if (invoice.buyerGstin) {
    // The whole reason a B2B invoice is filed invoice-wise: this is what the
    // buyer claims their input credit against.
    page.text(`GSTIN ${invoice.buyerGstin}`, buyerX, y(buyerTop), {
      font: "Helvetica-Bold",
      size: 8,
    });
    buyerTop += 10;
  }
  page.text(
    `Place of supply ${invoice.placeOfSupply}`,
    buyerX,
    y(buyerTop),
    { size: 8 },
  );
  buyerTop += 10;
  page.text(
    `Reverse charge ${invoice.reverseCharge ? "Yes" : "No"}`,
    buyerX,
    y(buyerTop),
    { size: 8 },
  );

  top = Math.max(top, buyerTop) + 18;

  // ── Line table ──────────────────────────────────────────────
  page.fill(MARGIN, y(top + 12), RIGHT - MARGIN, 14, 0.92);
  page.text("Description", COL.description, y(top + 2), { font: "Helvetica-Bold", size: 8 });
  page.text("HSN", COL.hsn, y(top + 2), { font: "Helvetica-Bold", size: 8 });
  page.textRight("Qty", COL.qtyRight, y(top + 2), { font: "Helvetica-Bold", size: 8 });
  page.textRight("Rate", COL.rateRight, y(top + 2), { font: "Helvetica-Bold", size: 8 });
  page.textRight("Taxable", COL.taxableRight, y(top + 2), { font: "Helvetica-Bold", size: 8 });
  page.textRight("Amount", COL.amountRight, y(top + 2), { font: "Helvetica-Bold", size: 8 });
  top += 18;

  for (const line of invoice.lines) {
    page.text(
      truncate(line.description, COL.descriptionWidth, 8),
      COL.description,
      y(top),
      { size: 8 },
    );
    page.text(line.hsn, COL.hsn, y(top), { size: 8 });
    page.textRight(String(line.quantity), COL.qtyRight, y(top), { size: 8 });
    page.textRight(printRupees(line.rate), COL.rateRight, y(top), { size: 8 });
    page.textRight(printRupees(line.taxableValue), COL.taxableRight, y(top), { size: 8 });
    page.textRight(printRupees(line.amount), COL.amountRight, y(top), { size: 8 });
    top += 11;
    // The rate is on its own line so the description column keeps its width;
    // a slab squeezed into the table would push titles into truncation.
    page.text(`GST ${line.slab}%`, COL.description + 8, y(top), { size: 7 });
    top += 12;
  }

  page.line(MARGIN, y(top), RIGHT, y(top));
  top += 14;

  // ── Totals ──────────────────────────────────────────────────
  const totalsX = MARGIN + 340;
  const row = (label: string, value: number, bold = false) => {
    page.text(label, totalsX, y(top), {
      size: bold ? 9 : 8,
      ...(bold ? { font: "Helvetica-Bold" as const } : {}),
    });
    page.textRight(printRupees(value), COL.amountRight, y(top), {
      size: bold ? 9 : 8,
      ...(bold ? { font: "Helvetica-Bold" as const } : {}),
    });
    top += 12;
  };

  row("Taxable value", invoice.taxableValue);
  if (invoice.interState) {
    row(`IGST`, invoice.igst);
  } else {
    row(`CGST`, invoice.cgst);
    row(`SGST`, invoice.sgst);
  }
  if (invoice.shipping > 0) row("Shipping", invoice.shipping);
  if (invoice.codFee > 0) row("Cash on delivery fee", invoice.codFee);

  // Twelve points of clearance, not four: at four the rule ran through the
  // middle of the glyphs it was meant to sit above.
  page.line(totalsX, y(top), RIGHT, y(top));
  top += 12;
  row("Total (INR)", invoice.total, true);

  top += 6;
  page.text("Amount in words", MARGIN, y(top), { font: "Helvetica-Bold", size: 8 });
  top += 11;
  for (const wordsRow of wrap(invoice.amountInWords, RIGHT - MARGIN, 8)) {
    page.text(wordsRow, MARGIN, y(top), { size: 8 });
    top += 10;
  }

  top += 8;
  page.text(
    `Order ${invoice.orderNumber}  ·  Paid by ${invoice.paymentMethod.toUpperCase()}`,
    MARGIN,
    y(top),
    { size: 8 },
  );
  top += 16;

  // ── HSN summary ─────────────────────────────────────────────
  // The table the return is filed from, printed on the invoice so the two can
  // be reconciled without opening the portal.
  page.text("HSN summary", MARGIN, y(top), { font: "Helvetica-Bold", size: 8 });
  top += 12;
  page.fill(MARGIN, y(top + 10), RIGHT - MARGIN, 12, 0.95);
  page.text("HSN", COL.description, y(top), { font: "Helvetica-Bold", size: 7 });
  page.textRight("Rate", MARGIN + 160, y(top), { font: "Helvetica-Bold", size: 7 });
  page.textRight("Taxable", MARGIN + 260, y(top), { font: "Helvetica-Bold", size: 7 });
  page.textRight("Tax", COL.amountRight, y(top), { font: "Helvetica-Bold", size: 7 });
  top += 13;

  for (const entry of invoice.hsn) {
    page.text(entry.hsn, COL.description, y(top), { size: 7 });
    page.textRight(`${entry.slab}%`, MARGIN + 160, y(top), { size: 7 });
    page.textRight(printRupees(entry.taxableValue), MARGIN + 260, y(top), { size: 7 });
    page.textRight(
      printRupees(entry.cgst + entry.sgst + entry.igst),
      COL.amountRight,
      y(top),
      { size: 7 },
    );
    top += 11;
  }

  // ── Declaration and signature ───────────────────────────────
  // Pinned to the foot of the page rather than flowing after the tables, so
  // the signature block sits where a reader expects it however short the order.
  const FOOT = PAGE_HEIGHT - 120;
  page.line(MARGIN, y(FOOT), RIGHT, y(FOOT));

  let foot = FOOT + 14;
  page.text("Declaration", MARGIN, y(foot), { font: "Helvetica-Bold", size: 7 });
  foot += 10;
  for (const declarationRow of wrap(invoice.declaration, 330, 7)) {
    page.text(declarationRow, MARGIN, y(foot), { size: 7 });
    foot += 9;
  }

  page.textRight(`For ${invoice.seller.name}`, RIGHT, y(FOOT + 20), { size: 8 });
  page.textRight("Authorised signatory", RIGHT, y(FOOT + 66), { size: 8 });

  // Said plainly rather than implied by a missing signature image.
  page.text(
    "This is a computer-generated invoice and does not require a signature.",
    MARGIN,
    y(PAGE_HEIGHT - MARGIN + 10),
    { size: 6.5 },
  );

  return renderPdf([page], `Tax invoice ${invoice.invoiceNumber}`);
}

/** The delivery address, on one string, in the order a postal address runs. */
function addressLine(invoice: InvoiceDocument): string {
  const address = invoice.billTo;
  const parts = [
    address.line1,
    address.line2,
    address.landmark,
    `${address.city} ${address.pincode}`,
  ].filter((part): part is string => Boolean(part && part.trim()));

  return parts.join(", ");
}

/** Break text to a width. Words only — a hyphenator is not worth it here. */
function wrap(value: string, maxWidth: number, size: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const rows: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) rows.push(current);
    current = word;
  }
  if (current) rows.push(current);

  return rows.length > 0 ? rows : [""];
}
