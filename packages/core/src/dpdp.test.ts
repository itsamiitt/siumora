import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ACKNOWLEDGE_HOURS,
  EXPORT_SCOPE,
  REDACTED,
  RESOLVE_DAYS,
  RETENTION_NOTICE,
  blockedReason,
  erasedPhone,
  isErasable,
  isErasedPhone,
  isOverdue,
  redactAddress,
  slaFor,
} from "./dpdp.ts";
import type { ShippingAddress } from "./order.ts";

const ADDRESS: ShippingAddress = {
  name: "Asha Menon",
  phone: "9876543210",
  line1: "Flat 3B, Sunrise Apartments, Linking Road",
  line2: "Bandra West",
  landmark: "Opposite the Sharma house",
  city: "Mumbai",
  stateCode: "27",
  pincode: "400001",
};

test("erases everything that identifies a person", () => {
  const redacted = redactAddress(ADDRESS);

  assert.equal(redacted.name, REDACTED);
  assert.equal(redacted.phone, REDACTED);
  assert.equal(redacted.line1, REDACTED);
  assert.equal(redacted.line2, REDACTED);
  // "Opposite the Sharma house" is as identifying as the street it is on.
  assert.equal(redacted.landmark, REDACTED);
});

test("keeps the place of supply, because the invoice is verified against it", () => {
  // The state code is what decided IGST versus CGST+SGST. Erasing it would make
  // the tax on a retained invoice unverifiable — the invoice has to be kept for
  // six years, so it has to stay checkable for six years.
  const redacted = redactAddress(ADDRESS);
  assert.equal(redacted.stateCode, "27");
  assert.equal(redacted.pincode, "400001");
  assert.equal(redacted.city, "Mumbai");
});

test("does not invent fields the address never had", () => {
  const bare: ShippingAddress = {
    name: "A",
    phone: "9876543210",
    line1: "Somewhere",
    city: "Mumbai",
    stateCode: "27",
    pincode: "400001",
  };
  const redacted = redactAddress(bare);
  assert.equal("line2" in redacted, false);
  assert.equal("landmark" in redacted, false);
});

test("will not erase an order still in flight", () => {
  // A parcel in transit needs an address to arrive at. Erasing mid-flight
  // protects nobody: it strands the goods and the money both.
  assert.equal(isErasable("shipped"), false);
  assert.equal(isErasable("out_for_delivery"), false);
  assert.equal(isErasable("ndr"), false);
  assert.equal(isErasable("delivered"), true);
  assert.equal(isErasable("rto"), true);
  assert.equal(isErasable("cancelled"), true);
});

test("says why it cannot finish yet, in words somebody can act on", () => {
  assert.equal(blockedReason(["delivered", "cancelled"]), null);

  const reason = blockedReason(["shipped", "delivered", "shipped"]);
  assert.match(reason ?? "", /2 orders are still in progress/);
  // Deduplicated and unslugged: "shipped, shipped" reads as a bug.
  assert.match(reason ?? "", /\(shipped\)/);
});

test("gives a phone that cannot be reversed", () => {
  // A hash would not do: the space of Indian mobile numbers is ten digits with
  // a fixed prefix, which is an afternoon of brute force.
  const erased = erasedPhone("abc123");
  assert.equal(isErasedPhone(erased), true);
  assert.equal(erased.includes("9876543210"), false);
  assert.equal(isErasedPhone("9876543210"), false);
});

test("promises the shorter of the two deadlines it is under", () => {
  const received = new Date("2026-07-01T10:00:00+05:30");
  const sla = slaFor(received);

  assert.equal(
    sla.acknowledgeBy.getTime() - received.getTime(),
    ACKNOWLEDGE_HOURS * 3_600_000,
  );
  // plan/11 names a 90-day ceiling and the e-commerce rules name a month. A
  // shop that publishes 90 days will use 90 days.
  assert.equal(RESOLVE_DAYS, 30);
  assert.equal(
    sla.resolveBy.getTime() - received.getTime(),
    RESOLVE_DAYS * 86_400_000,
  );
});

test("counts an unfinished request as overdue, a finished one never", () => {
  const past = new Date("2026-07-01T00:00:00Z");
  const now = new Date("2026-08-01T00:00:00Z");

  assert.equal(isOverdue("received", past, now), true);
  assert.equal(isOverdue("acknowledged", past, now), true);
  // A refusal is an outcome, not a debt.
  assert.equal(isOverdue("completed", past, now), false);
  assert.equal(isOverdue("refused", past, now), false);
  assert.equal(isOverdue("received", new Date("2026-09-01T00:00:00Z"), now), false);
});

test("the export scope names every table that holds personal data", () => {
  const tables = EXPORT_SCOPE.map((entry) => entry.table);
  for (const required of ["customers", "orders", "order_lines", "consent_log"]) {
    assert.ok(tables.includes(required as (typeof tables)[number]), required);
  }
  // Every entry says what it holds, so a reader does not have to open the
  // schema to know what they are getting.
  for (const entry of EXPORT_SCOPE) assert.ok(entry.holds.length > 10, entry.table);
});

test("the retention notice states the law it is relying on", () => {
  // Telling somebody "erased" while keeping an invoice with their order on it
  // for six years is misleading unless the reason travels with the answer.
  assert.ok(RETENTION_NOTICE.length > 0);
  assert.ok(RETENTION_NOTICE.some((entry) => /CGST Act/.test(entry.because)));
  for (const entry of RETENTION_NOTICE) {
    assert.ok(entry.keeps && entry.forHowLong && entry.because);
  }
});
