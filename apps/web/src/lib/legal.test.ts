import assert from "node:assert/strict";
import { test } from "node:test";

import { computeLegal } from "./legal.ts";

const CONTACT = {
  NEXT_PUBLIC_LEGAL_NAME: "Siumora Jewels Private Limited",
  NEXT_PUBLIC_LEGAL_ADDRESS: "12 Example Lane, Mumbai 400001",
  NEXT_PUBLIC_SUPPORT_EMAIL: "care@example.com",
  NEXT_PUBLIC_SUPPORT_PHONE: "+91 90000 00000",
  NEXT_PUBLIC_GRIEVANCE_OFFICER: "A. Officer",
  NEXT_PUBLIC_GRIEVANCE_EMAIL: "grievance@example.com",
};

test("nothing set: neither tier is complete", () => {
  const { contactComplete, legalComplete } = computeLegal({});
  assert.equal(contactComplete, false);
  assert.equal(legalComplete, false);
});

test("contact block alone publishes but does not open sale", () => {
  const { contactComplete, legalComplete } = computeLegal({ ...CONTACT });
  assert.equal(contactComplete, true);
  assert.equal(legalComplete, false);
});

test("private limited needs GSTIN and CIN to open sale", () => {
  const withoutCin = computeLegal({ ...CONTACT, NEXT_PUBLIC_GSTIN: "27ABCDE1234F1Z5" });
  assert.equal(withoutCin.legalComplete, false);

  const complete = computeLegal({
    ...CONTACT,
    NEXT_PUBLIC_GSTIN: "27ABCDE1234F1Z5",
    NEXT_PUBLIC_CIN: "U74999MH2026PTC000000",
  });
  assert.equal(complete.legalComplete, true);
  assert.equal(complete.legal.registrationIdentifier?.label, "CIN");
});

test("an LLP needs the LLPIN, and a CIN does not satisfy it", () => {
  const wrongIdentifier = computeLegal({
    ...CONTACT,
    NEXT_PUBLIC_LEGAL_ENTITY_TYPE: "llp",
    NEXT_PUBLIC_GSTIN: "27ABCDE1234F1Z5",
    NEXT_PUBLIC_CIN: "U74999MH2026PTC000000",
  });
  assert.equal(wrongIdentifier.legalComplete, false);

  const complete = computeLegal({
    ...CONTACT,
    NEXT_PUBLIC_LEGAL_ENTITY_TYPE: "llp",
    NEXT_PUBLIC_GSTIN: "27ABCDE1234F1Z5",
    NEXT_PUBLIC_LLPIN: "AAB-1234",
  });
  assert.equal(complete.legalComplete, true);
  assert.equal(complete.legal.registrationIdentifier?.label, "LLPIN");
});

test("a proprietorship needs no company identifier", () => {
  const { legal, legalComplete } = computeLegal({
    ...CONTACT,
    NEXT_PUBLIC_LEGAL_ENTITY_TYPE: "proprietorship",
    NEXT_PUBLIC_GSTIN: "27ABCDE1234F1Z5",
  });
  assert.equal(legalComplete, true);
  assert.equal(legal.registrationIdentifier, null);
});

test("an unknown entity type falls back to the strictest form", () => {
  // A typo can only demand more disclosure, never less: private limited
  // requires a CIN, so completeness stays false until one exists.
  const { legal, legalComplete } = computeLegal({
    ...CONTACT,
    NEXT_PUBLIC_LEGAL_ENTITY_TYPE: "pvt",
    NEXT_PUBLIC_GSTIN: "27ABCDE1234F1Z5",
  });
  assert.equal(legal.entityType, "private-limited");
  assert.equal(legalComplete, false);
});

test("whitespace or the placeholder dash do not count as configured", () => {
  const { contactComplete } = computeLegal({
    ...CONTACT,
    NEXT_PUBLIC_LEGAL_NAME: "   ",
  });
  assert.equal(contactComplete, false);
});
