import { test } from "node:test";
import assert from "node:assert/strict";

import { parsePincodeCsv } from "./import.ts";

test("a courier file reads by header name, with defaults for missing columns", () => {
  const result = parsePincodeCsv(
    "state_code,pincode,city,cod_available\n27,400001,Mumbai,yes\n7,110001,\"New Delhi, Central\",no\n",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.rows[0], {
    pincode: "400001",
    city: "Mumbai",
    state_code: "27",
    serviceable: true,
    cod_available: true,
    estimated_days: "4–6",
    rto_rate_bps: 0,
  });
  assert.equal(result.rows[1]!.state_code, "07", "a one-digit state code is padded");
  assert.equal(result.rows[1]!.city, "New Delhi, Central", "a quoted comma stays in the cell");
});

test("every bad line is named, and nothing is accepted from a bad file", () => {
  const result = parsePincodeCsv("pincode,state_code,serviceable,rto_rate_bps\n01234,27,yes,0\n400001,MH,maybe,-5\n");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.errors[0]!, /Line 2/);
  assert.ok(result.errors.some((error) => /state_code/.test(error)));
  assert.ok(result.errors.some((error) => /serviceable/.test(error)));
  assert.ok(result.errors.some((error) => /rto_rate_bps/.test(error)));
});

test("a duplicated pincode is caught", () => {
  const result = parsePincodeCsv("pincode,state_code\n400001,27\n400001,27\n");
  assert.equal(result.ok, false);
});

test("the header must name the two required columns", () => {
  assert.equal(parsePincodeCsv("pin,state\n400001,27").ok, false);
  assert.equal(parsePincodeCsv("pincode,state_code").ok, false);
});

test("a BOM and Windows line endings are tolerated", () => {
  assert.equal(parsePincodeCsv("﻿pincode,state_code\r\n400001,27\r\n").ok, true);
});
