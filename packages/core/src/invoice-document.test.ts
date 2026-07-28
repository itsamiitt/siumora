import assert from "node:assert/strict";
import { test } from "node:test";

import type { CartLine } from "./cart.ts";
import { ORIGIN_STATE_CODE } from "./gst.ts";
import {
  ADDRESS_MANDATORY_ABOVE,
  addressRequired,
  amountInWords,
  buildInvoice,
  groupIndian,
  printRupees,
  sellerConfigured,
  statutoryDate,
  type InvoiceInput,
  type Seller,
} from "./invoice-document.ts";
import type { ShippingAddress } from "./order.ts";

const SELLER: Seller = {
  name: "Siumora Jewels Private Limited",
  address: "12 Kala Ghoda, Fort, Mumbai 400001",
  gstin: "27AAPFU0939F1ZV",
  stateCode: ORIGIN_STATE_CODE,
  email: "hello@siumora.example",
  phone: "9000000001",
};

const BILL_TO: ShippingAddress = {
  name: "Asha Menon",
  phone: "9876543210",
  line1: "Flat 3B, Sunrise Apartments, Linking Road",
  city: "Mumbai",
  stateCode: ORIGIN_STATE_CODE,
  pincode: "400001",
};

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    variantId: "v1",
    sku: "SIU-PS-GLD",
    productHandle: "petal-studs",
    title: "Petal Studs",
    variantTitle: "Gold",
    imageUrl: "",
    mrp: 200000,
    unitPrice: 200000,
    quantity: 1,
    gstSlab: 5,
    hsn: "7113",
    piercedJewellery: true,
    ...overrides,
  };
}

function input(overrides: Partial<InvoiceInput> = {}): InvoiceInput {
  return {
    invoiceNumber: "SIU/2026-27/000001",
    invoiceDate: new Date("2026-07-15T10:00:00+05:30"),
    orderNumber: "SIU-00001",
    seller: SELLER,
    billTo: BILL_TO,
    lines: [line()],
    shipping: 0,
    codFee: 0,
    total: 200000,
    paymentMethod: "upi",
    ...overrides,
  };
}

test("carries every field rule 46 names", () => {
  const invoice = buildInvoice(input());

  for (const [field, value] of [
    ["invoice number", invoice.invoiceNumber],
    ["date", invoice.invoiceDate],
    ["supplier GSTIN", invoice.seller.gstin],
    ["place of supply", invoice.placeOfSupply],
    ["HSN", invoice.lines[0]?.hsn],
    ["amount in words", invoice.amountInWords],
    ["declaration", invoice.declaration],
  ] as const) {
    assert.ok(value && String(value).length > 0, `${field} is present`);
  }
  // Named rather than omitted: rule 46 has the field and a blank reads as
  // unknown rather than as "no".
  assert.equal(invoice.reverseCharge, false);
});

test("splits CGST and SGST at home and IGST away", () => {
  const home = buildInvoice(input());
  assert.equal(home.interState, false);
  assert.ok(home.cgst > 0 && home.sgst > 0);
  assert.equal(home.igst, 0);

  const away = buildInvoice(
    input({ billTo: { ...BILL_TO, stateCode: "07" } }),
  );
  assert.equal(away.interState, true);
  assert.equal(away.cgst, 0);
  assert.ok(away.igst > 0);
});

test("prints the right tax against each piece in a mixed-slab order", () => {
  // Averaged across the order, neither line reconciles to the HSN table and the
  // buyer's input credit is wrong on both.
  const invoice = buildInvoice(
    input({
      lines: [line(), line({ gstSlab: 18, hsn: "7117", unitPrice: 100000 })],
      total: 300000,
    }),
  );

  assert.equal(invoice.lines[0]?.slab, 5);
  assert.equal(invoice.lines[1]?.slab, 18);
  assert.equal(invoice.lines[0]?.hsn, "7113");
  assert.equal(invoice.lines[1]?.hsn, "7117");
});

test("the line tax adds up to the invoice tax", () => {
  const invoice = buildInvoice(
    input({
      lines: [line(), line({ gstSlab: 18, hsn: "7117", unitPrice: 100000 })],
      total: 300000,
    }),
  );

  const lineTax = invoice.lines.reduce(
    (sum, entry) => sum + entry.cgst + entry.sgst + entry.igst,
    0,
  );
  // If these disagree the invoice does not balance, whichever one is right.
  assert.equal(lineTax, invoice.cgst + invoice.sgst + invoice.igst);
});

test("dates the invoice the Indian way, in Indian time", () => {
  assert.equal(
    statutoryDate(new Date("2026-07-15T10:00:00+05:30")),
    "15-07-2026",
  );
  // 19:00 UTC on the 31st is already the 1st in India. A UTC read would date
  // the invoice into the wrong month, and at year end the wrong series.
  assert.equal(statutoryDate(new Date("2026-07-31T19:00:00Z")), "01-08-2026");
});

test("writes the amount in the Indian system, not the international one", () => {
  // 1,23,456 is one lakh twenty-three thousand. Reading it as one hundred
  // twenty-three thousand is the one unmistakable error on an Indian invoice.
  assert.equal(
    amountInWords(12345678),
    "One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees and Seventy Eight Paise Only",
  );
  assert.equal(amountInWords(100000000), "Ten Lakh Rupees Only");
  assert.equal(amountInWords(1000000000), "One Crore Rupees Only");
});

test("says nineteen rather than ten nine", () => {
  assert.equal(amountInWords(1900), "Nineteen Rupees Only");
  assert.equal(amountInWords(2100), "Twenty One Rupees Only");
  assert.equal(amountInWords(2000), "Twenty Rupees Only");
});

test("handles the amounts that break a naive implementation", () => {
  assert.equal(amountInWords(0), "Zero Rupees Only");
  // Paise alone: no rupee figure, but the invoice still has to say something.
  assert.equal(amountInWords(50), "Zero Rupees and Fifty Paise Only");
  assert.equal(amountInWords(100), "One Rupees Only");
  // A round crore has no lakhs, thousands or hundreds — every group empty but
  // the first.
  assert.equal(amountInWords(1001000000), "One Crore Ten Thousand Rupees Only");
  assert.equal(amountInWords(1010000000), "One Crore One Lakh Rupees Only");
});

test("groups digits two-two-three from the right", () => {
  assert.equal(groupIndian(123456), "1,23,456");
  assert.equal(groupIndian(12345678), "1,23,45,678");
  assert.equal(groupIndian(999), "999");
  assert.equal(groupIndian(1000), "1,000");
  assert.equal(groupIndian(0), "0");
});

test("prints rupees without the sign the PDF fonts cannot draw", () => {
  // U+20B9 is not in the base-14 fonts. Printed with one it comes out as a
  // wrong glyph or nothing, on the one document that must be unambiguous.
  const printed = printRupees(12345678);
  assert.equal(printed, "1,23,456.78");
  assert.equal(/[₹]/.test(printed), false);
  assert.equal(printRupees(50), "0.50");
  assert.equal(printRupees(-4900), "-49.00");
});

test("knows when the delivery address stops being optional", () => {
  const small = buildInvoice(input());
  assert.equal(addressRequired(small), false);

  const large = buildInvoice(
    input({
      total: ADDRESS_MANDATORY_ABOVE + 100,
      lines: [line({ unitPrice: ADDRESS_MANDATORY_ABOVE + 100 })],
    }),
  );
  assert.equal(addressRequired(large), true);

  // Registered buyers are outside the rule — their details are already on the
  // invoice by virtue of the GSTIN.
  const b2b = buildInvoice(
    input({
      total: ADDRESS_MANDATORY_ABOVE + 100,
      lines: [line({ unitPrice: ADDRESS_MANDATORY_ABOVE + 100 })],
      buyerGstin: "27AAPFU0939F1ZV",
    }),
  );
  assert.equal(addressRequired(b2b), false);
});

test("refuses to call an unconfigured seller a tax invoice", () => {
  // A document with a dash where the registration number belongs looks official
  // enough that nobody would check.
  assert.equal(sellerConfigured(SELLER), true);
  assert.equal(sellerConfigured({ ...SELLER, gstin: "—" }), false);
  assert.equal(sellerConfigured({ ...SELLER, name: "  " }), false);
});
