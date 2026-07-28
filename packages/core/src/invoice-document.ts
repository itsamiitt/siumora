import type { CartLine } from "./cart.ts";
import { ORIGIN_STATE_CODE } from "./gst.ts";
import { hsnSummary, summariseInvoice, type HsnSummaryRow } from "./invoice.ts";
import type { ShippingAddress } from "./order.ts";

/**
 * The tax invoice, as data.
 *
 * Rule 46 of the CGST Rules lists what a tax invoice must carry: the supplier's
 * name, address and GSTIN; a consecutive serial number; the date; the
 * recipient's details; the HSN code; the taxable value and the tax under each
 * head; the place of supply; and — for anything above ₹50,000 to an unregistered
 * buyer — the delivery address. Every one of those is assembled here, in one
 * place, so a missing field is a visible omission rather than a rendering
 * accident.
 *
 * Deliberately not a PDF. Layout is a rendering concern and a poor thing to
 * test; what has to be right is the arithmetic and the completeness, and both
 * are checkable as plain values.
 */

export interface Seller {
  readonly name: string;
  readonly address: string;
  readonly gstin: string;
  /** Two-digit state code of the place of business. Decides IGST vs CGST+SGST. */
  readonly stateCode: string;
  readonly email: string;
  readonly phone: string;
}

export interface InvoiceInput {
  readonly invoiceNumber: string;
  readonly invoiceDate: Date;
  readonly orderNumber: string;
  readonly seller: Seller;
  readonly billTo: ShippingAddress;
  /** Present makes this a B2B supply the buyer can claim input credit on. */
  readonly buyerGstin?: string | null;
  readonly lines: readonly CartLine[];
  readonly shipping: number;
  readonly codFee: number;
  readonly total: number;
  readonly paymentMethod: string;
}

export interface InvoiceLine {
  readonly description: string;
  readonly hsn: string;
  readonly quantity: number;
  /** Pre-tax unit price in paise. The printed rate, not the tag price. */
  readonly rate: number;
  readonly taxableValue: number;
  readonly slab: number;
  readonly cgst: number;
  readonly sgst: number;
  readonly igst: number;
  readonly amount: number;
}

export interface InvoiceDocument {
  readonly invoiceNumber: string;
  /** DD-MM-YYYY in IST, which is how every Indian statutory form wants it. */
  readonly invoiceDate: string;
  readonly orderNumber: string;
  readonly seller: Seller;
  readonly billTo: ShippingAddress;
  readonly buyerGstin: string | null;
  readonly placeOfSupply: string;
  readonly interState: boolean;
  readonly reverseCharge: boolean;
  readonly lines: readonly InvoiceLine[];
  readonly hsn: readonly HsnSummaryRow[];
  readonly taxableValue: number;
  readonly cgst: number;
  readonly sgst: number;
  readonly igst: number;
  readonly shipping: number;
  readonly codFee: number;
  readonly total: number;
  readonly amountInWords: string;
  readonly paymentMethod: string;
  /** The declaration a tax invoice carries above the signature. */
  readonly declaration: string;
}

/**
 * Above this, an unregistered buyer's delivery address is a required field.
 *
 * ₹50,000 in paise, per rule 46(s). Below it the address may be omitted; this
 * shop prints it either way, because a courier label without one is useless —
 * but the threshold is stated so the rule is visible rather than folded away.
 */
export const ADDRESS_MANDATORY_ABOVE = 5000000;

export function buildInvoice(input: InvoiceInput): InvoiceDocument {
  const interState = input.billTo.stateCode !== input.seller.stateCode;
  const hsn = hsnSummary(input.lines, { interState });
  const totals = summariseInvoice(hsn);

  const lines = input.lines.map((line): InvoiceLine => {
    // One line at a time, so a mixed-slab order prints the right tax against
    // each piece rather than an average nobody can reconcile.
    const [row] = hsnSummary([line], { interState });
    const summary = row as HsnSummaryRow;

    return {
      description: line.variantTitle
        ? `${line.title} — ${line.variantTitle}`
        : line.title,
      hsn: line.hsn,
      quantity: line.quantity,
      rate: Math.round(summary.taxableValue / line.quantity),
      taxableValue: summary.taxableValue,
      slab: summary.slab,
      cgst: summary.cgst,
      sgst: summary.sgst,
      igst: summary.igst,
      amount: summary.total,
    };
  });

  return {
    invoiceNumber: input.invoiceNumber,
    invoiceDate: statutoryDate(input.invoiceDate),
    orderNumber: input.orderNumber,
    seller: input.seller,
    billTo: input.billTo,
    buyerGstin: input.buyerGstin ?? null,
    placeOfSupply: input.billTo.stateCode,
    interState,
    // Reverse charge does not arise on retail jewellery. Printed as "No" rather
    // than omitted, because rule 46 names the field and a blank reads as unknown.
    reverseCharge: false,
    lines,
    hsn,
    taxableValue: totals.taxableValue,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    shipping: input.shipping,
    codFee: input.codFee,
    total: input.total,
    amountInWords: amountInWords(input.total),
    paymentMethod: input.paymentMethod,
    declaration:
      "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.",
  };
}

/** DD-MM-YYYY in IST. Every Indian statutory form wants that order. */
export function statutoryDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")}`;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];

const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty",
  "Ninety",
];

/**
 * Amount in words, in the Indian system.
 *
 * A required field on a tax invoice, and the one place where using the
 * international system is unmistakably wrong: 1,23,456 is one lakh twenty-three
 * thousand, not one hundred and twenty-three thousand. The grouping goes
 * two-two-three from the right — crore, lakh, thousand, hundred — which is why
 * this cannot be a `toLocaleString` away.
 */
export function amountInWords(paise: number): string {
  if (paise < 0) return `Minus ${amountInWords(-paise)}`;

  const rupees = Math.floor(paise / 100);
  const remainder = paise % 100;

  const rupeeWords = rupees === 0 ? "Zero" : indianWords(rupees);
  const paiseWords = remainder > 0 ? ` and ${indianWords(remainder)} Paise` : "";

  return `${rupeeWords} Rupees${paiseWords} Only`;
}

function indianWords(value: number): string {
  if (value === 0) return "";

  const parts: string[] = [];

  const crore = Math.floor(value / 10000000);
  if (crore > 0) {
    parts.push(`${indianWords(crore)} Crore`);
    value %= 10000000;
  }

  const lakh = Math.floor(value / 100000);
  if (lakh > 0) {
    parts.push(`${indianWords(lakh)} Lakh`);
    value %= 100000;
  }

  const thousand = Math.floor(value / 1000);
  if (thousand > 0) {
    parts.push(`${indianWords(thousand)} Thousand`);
    value %= 1000;
  }

  const hundred = Math.floor(value / 100);
  if (hundred > 0) {
    parts.push(`${ONES[hundred]} Hundred`);
    value %= 100;
  }

  if (value > 0) {
    // Below twenty is a single word, not tens-plus-ones: "Nineteen", never
    // "Ten Nine".
    parts.push(
      value < 20
        ? (ONES[value] as string)
        : `${TENS[Math.floor(value / 10)]}${value % 10 ? ` ${ONES[value % 10]}` : ""}`,
    );
  }

  return parts.join(" ");
}

/**
 * Rupees for print, without the ₹ sign.
 *
 * The rupee sign is U+20B9 and the base-14 PDF fonts do not have it — printed
 * with one it comes out as a wrong glyph or nothing at all. "INR" is what
 * appears instead, which is unambiguous and needs no embedded font.
 */
export function printRupees(paise: number): string {
  const negative = paise < 0;
  const absolute = Math.abs(paise);
  const rupees = Math.floor(absolute / 100);
  const remainder = String(absolute % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${groupIndian(rupees)}.${remainder}`;
}

/**
 * Digit grouping in the Indian system: 12,34,567 rather than 1,234,567.
 *
 * `toLocaleString("en-IN")` does this, but it also inserts characters that vary
 * by runtime ICU build, and a PDF content stream is not the place to discover
 * that a narrow no-break space arrived instead of a comma.
 */
export function groupIndian(value: number): string {
  const digits = String(value);
  if (digits.length <= 3) return digits;

  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
}

/** Whether the delivery address is a required field on this invoice. */
export function addressRequired(document: InvoiceDocument): boolean {
  return document.buyerGstin === null && document.total > ADDRESS_MANDATORY_ABOVE;
}

/** The seller, from the environment, with placeholders left visible. */
export const PLACEHOLDER_SELLER: Seller = {
  name: "—",
  address: "—",
  gstin: "—",
  stateCode: ORIGIN_STATE_CODE,
  email: "—",
  phone: "—",
};

/**
 * Whether this invoice can lawfully be issued.
 *
 * A tax invoice without the supplier's GSTIN is not a tax invoice. Rather than
 * print a document with a dash where the registration number belongs — which
 * looks official enough that nobody would check — the caller is told, and can
 * refuse.
 */
export function sellerConfigured(seller: Seller): boolean {
  return [seller.name, seller.address, seller.gstin].every(
    (value) => value.trim().length > 0 && value.trim() !== "—",
  );
}
