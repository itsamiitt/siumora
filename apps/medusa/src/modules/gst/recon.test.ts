import { test } from "node:test";
import assert from "node:assert/strict";

import { computeInvoice, formatInvoiceNumber, toInvoiceLines, type GstInvoiceRow } from "./invoice.ts";
import { checkSeries, describeFinding, reconcileInvoices, type ReconOrderWire } from "./recon.ts";

const goldStuds = {
  quantity: 2,
  unit_price: 1990,
  variant_id: "variant_studs",
  variant_sku: "SIU-PS-GLD",
  variant_title: "Gold",
  product_title: "Petal Studs",
  product_handle: "petal-studs",
  variant: {
    id: "variant_studs",
    metadata: { price_paise: 199000, mrp_paise: 249000 },
    product: { metadata: { gst_slab: 5, hsn: "7113" } },
  },
};

/** An order delivered in Maharashtra (the origin state): intra-state. */
function order(id: string, province = "27", items: ReconOrderWire["items"] = [goldStuds]): ReconOrderWire {
  return { id, shipping_address: { province }, items };
}

/** The invoice the issue path would have written for that order. */
function issued(orderId: string, sequence: number, interstate = false): GstInvoiceRow {
  const { rows, totals } = computeInvoice(toInvoiceLines([goldStuds]), { interState: interstate });
  return {
    id: `gsinv_${sequence}`,
    order_id: orderId,
    financial_year: "2026-27",
    sequence,
    invoice_number: formatInvoiceNumber(sequence, "2026-27"),
    buyer_gstin: null,
    interstate,
    rows,
    totals,
    created_at: new Date("2026-11-20T10:00:00Z"),
  };
}

test("clean books report nothing", () => {
  assert.deepEqual(
    reconcileInvoices([order("o1"), order("o2", "29")], [issued("o1", 1), issued("o2", 2, true)]),
    [],
  );
});

test("a placed order without an invoice is named", () => {
  const findings = reconcileInvoices([order("o1"), order("o2")], [issued("o1", 1)]);
  assert.deepEqual(findings.map((f) => [f.kind, f.orderId]), [["missing_invoice", "o2"]]);
});

test("an invoice whose order is gone is an orphan", () => {
  const findings = reconcileInvoices([], [issued("ghost", 1)]);
  assert.deepEqual(findings.map((f) => f.kind), ["orphan_invoice"]);
  assert.equal(findings[0]!.invoiceNumber, "SIU/2026-27/000001");
});

test("an invoice total that no longer matches the order's lines is drift", () => {
  const invoice = issued("o1", 1);
  const changed = { ...goldStuds, quantity: 3 };
  const findings = reconcileInvoices([order("o1", "27", [changed])], [invoice]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.kind, "totals_drift");
  assert.match(findings[0]!.detail, /total: invoice 398000 vs order 597000/);
});

test("stored rows that stop re-adding are caught even when the headline total holds", () => {
  const invoice = issued("o1", 1);
  const [row] = invoice.rows;
  // Move a paisa between heads inside the row: the row's own sum breaks.
  const tampered = { ...invoice, rows: [{ ...row!, cgst: row!.cgst + 1 }] };
  const findings = reconcileInvoices([order("o1")], [tampered]);
  assert.deepEqual(findings.map((f) => f.kind), ["rows_inconsistent"]);
});

test("a snapshot that disagrees with the delivery state is named", () => {
  // Delivered to Karnataka (29) but invoiced as intra-state.
  const findings = reconcileInvoices([order("o1", "29")], [issued("o1", 1, false)]);
  assert.ok(findings.some((f) => f.kind === "interstate_mismatch"));
});

test("an order whose lines lost their tax fields is unreadable, not a crash", () => {
  const noHsn = { ...goldStuds, variant: { ...goldStuds.variant, product: { metadata: { gst_slab: 5 } } } };
  const findings = reconcileInvoices([order("o1", "27", [noHsn])], [issued("o1", 1)]);
  assert.deepEqual(findings.map((f) => f.kind), ["lines_unreadable"]);
});

test("the series runs 1..N per financial year", () => {
  const entry = (financial_year: string, sequence: number) => ({
    financial_year,
    sequence,
    invoice_number: formatInvoiceNumber(sequence, financial_year),
  });
  assert.deepEqual(checkSeries([entry("2026-27", 1), entry("2026-27", 2), entry("2027-28", 1)]), []);

  const gap = checkSeries([entry("2026-27", 1), entry("2026-27", 4)]);
  assert.deepEqual(gap.map((f) => f.kind), ["series_gap"]);
  assert.match(gap[0]!.detail, /2026-27 is missing sequence 2, 3/);

  const dup = checkSeries([entry("2026-27", 1), entry("2026-27", 1)]);
  assert.deepEqual(dup.map((f) => f.kind), ["series_duplicate"]);
});

test("a number spelled differently from its sequence is malformed", () => {
  const findings = checkSeries([{ financial_year: "2026-27", sequence: 1, invoice_number: "SIU/2026-27/1" }]);
  assert.deepEqual(findings.map((f) => f.kind), ["number_malformed"]);
});

test("findings describe themselves on one line", () => {
  assert.equal(
    describeFinding({ kind: "missing_invoice", orderId: "o2", detail: "placed order has no invoice" }),
    "missing_invoice [o2]: placed order has no invoice",
  );
});
