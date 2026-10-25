import { test } from "node:test";
import assert from "node:assert/strict";

import { parseRemittanceCsv, rupeesToPaise } from "./csv.ts";

test("rupeesToPaise reads rupee amounts as integer paise", () => {
  assert.equal(rupeesToPaise("₹1,299.50"), 129950);
  assert.equal(rupeesToPaise("Rs. 40"), 4000);
  assert.equal(rupeesToPaise("-12.5"), -1250);
  assert.equal(rupeesToPaise(""), 0);
  assert.equal(rupeesToPaise("abc"), undefined);
});

test("a Shiprocket-style export becomes ingest rows", () => {
  const parsed = parseRemittanceCsv(
    [
      "﻿Order ID,COD Amount (INR),Freight Charges,Remitted Amount,Charged Weight (kg)",
      'SIU-00042,"1,299.00",61.50,"1,237.50",0.75',
      "SIU-00043,999,0,999,",
      "",
    ].join("\r\n"),
  );
  assert.deepEqual(parsed, {
    ok: true,
    rows: [
      { orderNumber: "SIU-00042", collected: 129900, deductions: 6150, remitted: 123750, chargedWeightGrams: 750 },
      { orderNumber: "SIU-00043", collected: 99900, deductions: 0, remitted: 99900 },
    ],
  });
});

test("missing columns and bad amounts are named, with the line", () => {
  assert.match((parseRemittanceCsv("Order,Amount\nSIU-1,10") as { message: string }).message, /COD collected, remitted amount/);
  assert.match(
    (parseRemittanceCsv("Order Number,Collected,Remitted\nSIU-1,ten,10") as { message: string }).message,
    /Line 2: collected/,
  );
  assert.equal(parseRemittanceCsv("Order Number,Collected,Remitted").ok, false);
});
