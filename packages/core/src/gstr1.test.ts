import assert from "node:assert/strict";
import { test } from "node:test";

import type { CartLine } from "./cart.ts";
import { ORIGIN_STATE_CODE } from "./gst.ts";
import {
  B2CL_THRESHOLD,
  buildGstr1,
  gstinStateCode,
  isValidGstin,
  monthOf,
  type Gstr1Order,
} from "./gstr1.ts";

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

function order(overrides: Partial<Gstr1Order> = {}): Gstr1Order {
  return {
    invoiceNumber: "SIU/2026-27/000001",
    invoiceDate: new Date("2026-07-15T10:00:00+05:30"),
    total: 200000,
    stateCode: ORIGIN_STATE_CODE,
    lines: [line()],
    ...overrides,
  };
}

test("files a registered buyer's supply invoice by invoice", () => {
  // The buyer claims input credit against each one, so it cannot be summarised.
  const gstr1 = buildGstr1(
    [order({ buyerGstin: "27AAPFU0939F1ZV" })],
    "2026-07",
  );

  assert.equal(gstr1.b2b.length, 1);
  assert.equal(gstr1.b2b[0]?.gstin, "27AAPFU0939F1ZV");
  assert.equal(gstr1.b2cs.length, 0);
});

test("summarises consumer supplies by state and rate", () => {
  const gstr1 = buildGstr1(
    [order(), order({ invoiceNumber: "SIU/2026-27/000002" })],
    "2026-07",
  );

  assert.equal(gstr1.b2b.length, 0);
  assert.equal(gstr1.b2cs.length, 1);
  assert.equal(gstr1.b2cs[0]?.placeOfSupply, ORIGIN_STATE_CODE);
  assert.equal(gstr1.b2cs[0]?.slab, 5);
  // Two orders collapsed into one summary line.
  assert.equal(gstr1.b2cs[0]?.taxableValue, 380952);
});

test("keeps different rates and different states apart", () => {
  const gstr1 = buildGstr1(
    [
      order(),
      order({ stateCode: "07", invoiceNumber: "SIU/2026-27/000002" }),
      order({
        invoiceNumber: "SIU/2026-27/000003",
        lines: [line({ gstSlab: 18, hsn: "7117" })],
      }),
    ],
    "2026-07",
  );

  assert.equal(gstr1.b2cs.length, 3);
  assert.deepEqual(
    gstr1.b2cs.map((row) => `${row.placeOfSupply}/${row.slab}/${row.type}`).sort(),
    ["07/5/inter", `${ORIGIN_STATE_CODE}/18/intra`, `${ORIGIN_STATE_CODE}/5/intra`].sort(),
  );
});

test("splits CGST and SGST at home, IGST away", () => {
  const home = buildGstr1([order()], "2026-07");
  assert.ok(home.b2cs[0]!.cgst > 0 && home.b2cs[0]!.sgst > 0);
  assert.equal(home.b2cs[0]!.igst, 0);

  const away = buildGstr1([order({ stateCode: "07" })], "2026-07");
  assert.equal(away.b2cs[0]!.cgst, 0);
  assert.ok(away.b2cs[0]!.igst > 0);
});

test("files a large inter-state consumer supply invoice-wise", () => {
  const big = B2CL_THRESHOLD + 100000;
  const gstr1 = buildGstr1(
    [
      order({
        stateCode: "07",
        total: big,
        lines: [line({ unitPrice: big })],
      }),
    ],
    "2026-07",
  );

  // Over the threshold it is B2CL, not a summary row — the statute wants the
  // invoice, and a single large order silently landing in B2CS is a misfiling.
  assert.equal(gstr1.b2cl.length, 1);
  assert.equal(gstr1.b2cl[0]?.gstin, null);
  assert.equal(gstr1.b2cs.length, 0);
});

test("keeps a large intra-state consumer supply in the summary", () => {
  // The threshold is inter-state only. Applying it at home would move supplies
  // into a table that does not accept them.
  const gstr1 = buildGstr1(
    [order({ total: B2CL_THRESHOLD + 100000, lines: [line({ unitPrice: B2CL_THRESHOLD + 100000 })] })],
    "2026-07",
  );
  assert.equal(gstr1.b2cl.length, 0);
  assert.equal(gstr1.b2cs.length, 1);
});

test("leaves out anything that never raised an invoice", () => {
  // A return listing supplies the seller cannot produce an invoice for is a
  // return that fails scrutiny.
  const gstr1 = buildGstr1(
    [order({ invoiceNumber: null }), order({ excluded: true })],
    "2026-07",
  );
  assert.equal(gstr1.totals.invoices, 0);
  assert.equal(gstr1.b2cs.length, 0);
});

test("only takes the period asked for", () => {
  const gstr1 = buildGstr1(
    [
      order(),
      order({
        invoiceNumber: "SIU/2026-27/000002",
        invoiceDate: new Date("2026-08-02T10:00:00+05:30"),
      }),
    ],
    "2026-07",
  );
  assert.equal(gstr1.totals.invoices, 1);
});

test("reads the period in IST", () => {
  // 19:00 UTC on the 31st is already the 1st in India. A UTC read would file
  // the invoice in the wrong month — and the month is the return.
  const lateNight = new Date("2026-07-31T19:00:00Z");
  assert.equal(monthOf(lateNight), "2026-08");
});

test("the HSN table covers every supply however it was filed", () => {
  const gstr1 = buildGstr1(
    [
      order({ buyerGstin: "27AAPFU0939F1ZV" }),
      order({ invoiceNumber: "SIU/2026-27/000002", stateCode: "07" }),
    ],
    "2026-07",
  );

  const hsnTaxable = gstr1.hsn.reduce((sum, row) => sum + row.taxableValue, 0);
  // The cross-check on the rest of the return: it has to reconcile to the same
  // taxable value the invoice tables did.
  assert.equal(hsnTaxable, gstr1.totals.taxableValue);
});

test("the HSN table does not put an inter-state supply on CGST", () => {
  // One call for the whole period would apply whichever flag was passed to
  // every line, quietly moving tax between heads.
  const gstr1 = buildGstr1(
    [
      order(),
      order({ invoiceNumber: "SIU/2026-27/000002", stateCode: "07" }),
    ],
    "2026-07",
  );

  const totalCgst = gstr1.hsn.reduce((sum, row) => sum + row.cgst, 0);
  const totalIgst = gstr1.hsn.reduce((sum, row) => sum + row.igst, 0);
  assert.ok(totalCgst > 0, "the intra-state order contributes CGST");
  assert.ok(totalIgst > 0, "the inter-state order contributes IGST");
  assert.equal(totalCgst + totalIgst + gstr1.hsn.reduce((s, r) => s + r.sgst, 0), gstr1.totals.cgst + gstr1.totals.sgst + gstr1.totals.igst);
});

test("accepts a real GSTIN and rejects a mistyped one", () => {
  assert.equal(isValidGstin("27AAPFU0939F1ZV"), true);
  assert.equal(isValidGstin("27aapfu0939f1zv"), true, "case is not the customer's problem");

  // Right shape, wrong check digit — the typo the structural test alone misses,
  // and the one that denies the buyer their input credit.
  assert.equal(isValidGstin("27AAPFU0939F1ZW"), false);
  assert.equal(isValidGstin("27AAPFU0939F1ZV1"), false);
  assert.equal(isValidGstin("AAPFU0939F1ZV"), false);
  assert.equal(isValidGstin(""), false);
});

test("reads the state out of a GSTIN", () => {
  assert.equal(gstinStateCode("27AAPFU0939F1ZV"), "27");
});

test("the check digit round-trips for any well-formed prefix", () => {
  // A property test rather than a list of sample GSTINs: published "examples"
  // are frequently fabricated and fail the checksum, so they prove nothing
  // either way. This proves the digit the algorithm computes is the digit it
  // accepts, across the whole character space.
  const CODES = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const compute = (first14: string) => {
    let sum = 0;
    for (let i = 0; i < 14; i += 1) {
      const weighted = CODES.indexOf(first14[i] as string) * (i % 2 === 0 ? 1 : 2);
      sum += Math.floor(weighted / 36) + (weighted % 36);
    }
    return CODES[(36 - (sum % 36)) % 36] as string;
  };

  const prefixes = [
    "27AAPFU0939F1Z",
    "29AAGCB7383J1Z",
    "07ZZZZZ9999Z9Z",
    "01AAAAA0000A1Z",
    "37QWERT1234Y8Z",
  ];

  for (const prefix of prefixes) {
    const valid = prefix + compute(prefix);
    assert.equal(isValidGstin(valid), true, valid);

    // And every other check digit is refused, which is the whole point.
    for (const wrong of CODES) {
      if (wrong === compute(prefix)) continue;
      assert.equal(isValidGstin(prefix + wrong), false, prefix + wrong);
    }
  }
});
